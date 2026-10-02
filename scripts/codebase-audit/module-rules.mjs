// File-composition rules from AGENTS.md ("Keep files cohesive", the
// stateful-class rule, `contracts.ts` placement, and test-double placement),
// checked by parsing each file with the TypeScript compiler.

import { posix } from "node:path";

import ts from "typescript";

import {
  folderSegments,
  isProductionFile,
  isTestFile,
  isTestingFile,
} from "./file-kinds.mjs";

const FILE_LINE_REVIEW_LIMIT = 500;
const TEST_DOUBLE_NAME =
  /^(Fake|Recording|Controlled|Stub|Mock|Spy|InMemory)[A-Z]/;
const ROOT_ENTRY_MODULE = /^(index|app|create-[\w-]+)\.js$/;
const TYPE_DECLARATION_FOLDERS = new Set(["schema", "types"]);

/** Runs every composition rule over one inventory. */
export function checkModules(inventory) {
  const parsed = inventory.files.map((file) => ({ file, source: parse(file) }));
  const byPath = new Map(parsed.map((entry) => [entry.file.path, entry]));
  return parsed.flatMap(({ file, source }) => [
    ...checkClassCount(file, source),
    ...checkPrivateMethods(file, source),
    ...checkFileSize(file),
    ...checkTestDoublePlacement(file, source),
    ...checkRootEntryImports(file, source),
    ...checkSharedTypeImports(file, source, byPath),
  ]);
}

/** Parses one file without type information; every rule here is syntactic. */
function parse(file) {
  return ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Top-level class declarations in a file. */
function classesOf(source) {
  return source.statements.filter(ts.isClassDeclaration);
}

/** Error subclasses may share a domain errors file, so they are not counted. */
function isErrorClass(node) {
  return (node.heritageClauses ?? []).some((clause) =>
    clause.types.some((type) => type.expression.getText().endsWith("Error")),
  );
}

/** One concrete class per production file; error subclasses share an errors file. */
export function checkClassCount(file, source) {
  if (!isProductionFile(file)) return [];
  const concrete = classesOf(source).filter((node) => !isErrorClass(node));
  if (concrete.length <= 1) return [];
  return [
    {
      rule: "one-class-per-file",
      severity: "error",
      files: [file.path],
      message: `${concrete.length} concrete classes (${concrete
        .map((node) => node.name?.text ?? "anonymous")
        .join(", ")}); give each its own file`,
    },
  ];
}

/** A private method that never reads `this` belongs beside the class, not in it. */
export function checkPrivateMethods(file, source) {
  if (!isProductionFile(file)) return [];
  const findings = [];
  for (const node of classesOf(source)) {
    for (const member of node.members) {
      if (!isPrivateInstanceMethod(member) || member.body === undefined)
        continue;
      if (readsThis(member.body)) continue;
      const line =
        source.getLineAndCharacterOfPosition(member.getStart()).line + 1;
      findings.push({
        rule: "private-without-this",
        severity: "error",
        files: [file.path],
        line,
        message: `${node.name?.text ?? "class"}.${member.name.getText()} never reads this; move it beside the class`,
      });
    }
  }
  return findings;
}

/** Private instance methods and accessors, by keyword or `#name`. */
function isPrivateInstanceMethod(member) {
  if (!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member)) {
    return false;
  }
  const modifiers = ts.getModifiers(member) ?? [];
  if (modifiers.some((m) => m.kind === ts.SyntaxKind.StaticKeyword))
    return false;
  return (
    ts.isPrivateIdentifier(member.name) ||
    modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)
  );
}

/** Whether any `this` or `super` appears in a body. */
function readsThis(node) {
  if (
    node.kind === ts.SyntaxKind.ThisKeyword ||
    node.kind === ts.SyntaxKind.SuperKeyword
  ) {
    return true;
  }
  return ts.forEachChild(node, readsThis) ?? false;
}

/** Large production files get the stateful-class check, not a hard limit. */
export function checkFileSize(file) {
  if (!isProductionFile(file)) return [];
  const lines = file.content.split("\n").length;
  if (lines <= FILE_LINE_REVIEW_LIMIT) return [];
  return [
    {
      rule: "file-size",
      severity: "review",
      files: [file.path],
      message: `${lines} lines; check that its class reads as its transitions (stateful-class rule)`,
    },
  ];
}

/** Test doubles and fixtures live in `src/testing/`, never in production or test files. */
export function checkTestDoublePlacement(file, source) {
  if (isTestingFile(file)) return [];
  return classesOf(source)
    .filter((node) => TEST_DOUBLE_NAME.test(node.name?.text ?? ""))
    .map((node) => ({
      rule: "test-double-placement",
      severity: isTestFile(file) ? "review" : "error",
      files: [file.path],
      message: `${node.name.text} looks like a test double; move it to src/testing/`,
    }));
}

/** Domain files never import a `src/` root entry point; shared types go in contracts.ts. */
export function checkRootEntryImports(file, source) {
  if (!isProductionFile(file) || !file.srcPath.includes("/")) return [];
  return relativeImports(source)
    .map((declaration) => resolveSrcPath(file, declaration))
    .filter((target) => !target.includes("/") && ROOT_ENTRY_MODULE.test(target))
    .map((target) => ({
      rule: "root-entry-import",
      severity: "error",
      files: [file.path],
      message: `imports the src/ root entry point ${target}; import the domain module or its contracts.ts`,
    }));
}

/**
 * Types shared between a domain's capability folders belong in that domain's
 * `contracts.ts`. Importing another capability's class is composition and fine.
 */
export function checkSharedTypeImports(file, source, byPath) {
  if (!isProductionFile(file)) return [];
  const [domain, capability] = folderSegments(file.srcPath);
  if (capability === undefined) return [];

  const findings = [];
  for (const declaration of relativeImports(source)) {
    const target = resolveSrcPath(file, declaration);
    const [targetDomain, targetCapability] = folderSegments(target);
    if (targetDomain !== domain || targetCapability === undefined) continue;
    if (targetCapability === capability) continue;
    if (posix.basename(target) === "contracts.js") continue;
    // `schema/` and `types/` are sanctioned homes for type-only declarations.
    if (TYPE_DECLARATION_FOLDERS.has(targetCapability)) continue;

    const targetPath = `${file.workspace}/src/${target.replace(/\.js$/, ".ts")}`;
    const targetEntry = byPath.get(targetPath);
    if (targetEntry === undefined) continue;
    const classNames = new Set(
      classesOf(targetEntry.source).map((node) => node.name?.text),
    );
    const sharedTypes = typeOnlyNames(declaration).filter(
      (name) => !classNames.has(name),
    );
    if (sharedTypes.length === 0) continue;
    findings.push({
      rule: "shared-type-placement",
      severity: "review",
      files: [file.path],
      message: `imports ${sharedTypes.join(", ")} from ${targetCapability}/; move types shared across ${domain}/ into ${domain}/contracts.ts`,
    });
  }
  return findings;
}

/** Relative import declarations; package imports are outside these rules. */
function relativeImports(source) {
  return source.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith("."),
  );
}

/** Resolves an import specifier to a `src/`-relative path. */
function resolveSrcPath(file, declaration) {
  return posix.normalize(
    posix.join(posix.dirname(file.srcPath), declaration.moduleSpecifier.text),
  );
}

/** Names an import brings in for types only, via `import type` or inline `type`. */
function typeOnlyNames(declaration) {
  const clause = declaration.importClause;
  if (clause === undefined) return [];
  const bindings = clause.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) return [];
  return bindings.elements
    .filter((element) => clause.isTypeOnly || element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text);
}

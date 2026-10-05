// The export rule from AGENTS.md ("Export only the package or module surface
// that another file actually needs"), checked by matching every production
// export against the relative imports and re-exports of the whole inventory.
// Package entry points have a separate consumer check; internal re-exports
// count as uses only for the module-level rule.

import { posix } from "node:path";

import ts from "typescript";

import { isEntryPointName, isProductionFile } from "./file-kinds.mjs";
import { parseSource } from "./parse-source.mjs";

const ALL_NAMES = "*";

/** Flags production exports that no other file imports or re-exports. */
export function checkExports(inventory) {
  const paths = new Set(inventory.files.map((file) => file.path));
  const parsed = inventory.files.map((file) => ({
    file,
    source: parseSource(file),
  }));
  const used = new Set();
  for (const { file, source } of parsed) {
    for (const use of usesOf(file, source, paths)) used.add(use);
  }

  const findings = [];
  for (const { file, source } of parsed) {
    if (!isProductionFile(file) || isEntryPointName(file.srcPath)) continue;
    if (used.has(useKey(file.path, ALL_NAMES))) continue;
    for (const { name, line } of exportsOf(source)) {
      if (used.has(useKey(file.path, name))) continue;
      findings.push({
        rule: "unused-export",
        severity: "error",
        files: [file.path],
        line,
        message: `${name} is exported but no other file imports it; drop the export`,
      });
    }
  }
  return findings;
}

/** One key per imported name of a target file. */
function useKey(path, name) {
  return `${path}#${name}`;
}

/** The names a file's exported declarations and local export lists declare. */
function exportsOf(source, includeReexports = false) {
  const names = [];
  const add = (name, node) =>
    names.push({
      name,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      // Re-exports from another module are uses of that module, not new surface.
      if (statement.moduleSpecifier !== undefined && !includeReexports)
        continue;
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) add(element.name.text, element);
      } else if (clause !== undefined && ts.isNamespaceExport(clause)) {
        add(clause.name.text, clause);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      add("default", statement);
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? [])
      : [];
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      add("default", statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        add(declaration.name.getText(), declaration);
      }
    } else if (statement.name !== undefined) {
      add(statement.name.text, statement);
    }
  }
  return names;
}

/** Checks named package exports against consumers outside the owning workspace. */
export function checkPackageExports(inventory) {
  const paths = new Set(inventory.files.map((file) => file.path));
  const entries = inventory.workspaces
    .filter((workspace) => workspace.name.startsWith("packages/"))
    .map((workspace) => ({
      ...workspace,
      entry: inventory.files.find(
        (file) =>
          file.workspace === workspace.name && file.srcPath === "index.ts",
      ),
    }))
    .filter((workspace) => workspace.entry !== undefined);
  const used = new Set();
  for (const file of inventory.consumerFiles ?? inventory.files) {
    const source = parseSource(file);
    for (const { specifier, names } of packageReferences(source)) {
      const target = entries.find(
        (workspace) =>
          workspace.name !== file.workspace &&
          (specifier === workspace.packageName ||
            (specifier.startsWith(".") &&
              resolveTarget(file, specifier, paths) === workspace.entry.path)),
      );
      if (target === undefined) continue;
      for (const name of names) {
        used.add(useKey(target.entry.path, name));
      }
    }
  }
  const findings = [];
  for (const { entry } of entries) {
    if (used.has(useKey(entry.path, ALL_NAMES))) continue;
    for (const { name, line } of exportsOf(parseSource(entry), true)) {
      if (used.has(useKey(entry.path, name))) continue;
      findings.push({
        rule: "unused-package-export",
        severity: "error",
        files: [entry.path],
        line,
        symbol: name,
        message: `${name} is exported but no other workspace imports it; drop the export or record a justified exception`,
      });
    }
  }
  return findings;
}

/** Includes type expressions and lazy loading so valid consumers are never pruned. */
function packageReferences(source) {
  const references = [];
  /** Literal specifiers are decidable; computed dynamic imports remain a review concern. */
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        references.push({
          specifier: node.moduleSpecifier.text,
          names: importedNames(node, ts.isImportDeclaration(node)),
        });
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      let qualifier = node.qualifier;
      while (qualifier && ts.isQualifiedName(qualifier))
        qualifier = qualifier.left;
      references.push({
        specifier: node.argument.literal.text,
        names: [qualifier ? qualifier.text : ALL_NAMES],
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      references.push({
        specifier: node.arguments[0].text,
        names: [ALL_NAMES],
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references;
}

/** Every `path#name` a file imports or re-exports through a relative specifier. */
function usesOf(file, source, paths) {
  const uses = [];
  for (const statement of source.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    if (!specifier.text.startsWith(".")) continue;
    const target = resolveTarget(file, specifier.text, paths);
    if (target === undefined) continue;
    for (const name of importedNames(statement, isImport)) {
      uses.push(useKey(target, name));
    }
  }
  return uses;
}

/** The names one import or re-export statement takes from its target. */
function importedNames(statement, isImport) {
  if (isImport) {
    const clause = statement.importClause;
    // A side-effect import uses no names.
    if (clause === undefined) return [];
    const names = clause.name === undefined ? [] : ["default"];
    const bindings = clause.namedBindings;
    if (bindings === undefined) return names;
    if (ts.isNamespaceImport(bindings)) return [ALL_NAMES];
    return [
      ...names,
      ...bindings.elements.map((e) => (e.propertyName ?? e.name).text),
    ];
  }
  const clause = statement.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return [ALL_NAMES];
  return clause.elements.map((e) => (e.propertyName ?? e.name).text);
}

/** Resolves a relative `.js` specifier to the inventory file it compiles from. */
function resolveTarget(file, specifier, paths) {
  const base = posix
    .normalize(posix.join(posix.dirname(file.path), specifier))
    .replace(/\.js$/, "");
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) =>
    paths.has(candidate),
  );
}

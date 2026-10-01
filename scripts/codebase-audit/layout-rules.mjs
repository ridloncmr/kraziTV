// Source-layout rules from AGENTS.md ("Lay out every package or app `src/`
// the same way") and ADR 0010, checked over the inventory's file paths.

import {
  folderSegments,
  isCountedSourceFile,
  isEntryPointName,
  isEntryPointTestName,
  isTestingFile,
} from "./file-kinds.mjs";

const VAGUE_FOLDERS = new Set([
  "internal",
  "utils",
  "common",
  "helpers",
  "shared",
  "lib",
  "misc",
]);
const FLAT_REVIEW_LIMIT = 4;
const FLAT_ERROR_LIMIT = 8;
const CANONICAL_TESTING_EXCLUDE = "src/testing/**/*.ts";
const CANONICAL_TEST_EXCLUDE = "src/**/*.test.ts";

/** Runs every layout rule over one inventory. */
export function checkLayout(inventory) {
  return [
    ...checkSrcRoot(inventory.files),
    ...checkFolderNames(inventory.files),
    ...checkNestingDepth(inventory.files),
    ...checkGrouping(inventory.files),
    ...checkBuildExcludes(inventory),
  ];
}

/** `src/` root holds only entry points and the tests beside them. */
export function checkSrcRoot(files) {
  return files
    .filter((file) => !file.srcPath.includes("/"))
    .filter(
      (file) =>
        !isEntryPointName(file.srcPath) && !isEntryPointTestName(file.srcPath),
    )
    .map((file) => ({
      rule: "src-root",
      severity: "error",
      files: [file.path],
      message: `${file.srcPath} is not an entry point; move it into a domain folder`,
    }));
}

/**
 * Folder names must say what belongs in them, `testing/` exists only at the
 * `src/` root, and integration suites live outside `src/`.
 */
export function checkFolderNames(files) {
  const findings = new Map();
  for (const file of files) {
    const segments = folderSegments(file.srcPath);
    segments.forEach((segment, index) => {
      const folder = `${file.workspace}/src/${segments.slice(0, index + 1).join("/")}/`;
      if (findings.has(folder)) return;
      if (VAGUE_FOLDERS.has(segment)) {
        findings.set(folder, {
          rule: "vague-folder",
          severity: "error",
          files: [folder],
          message: `"${segment}/" is a vague folder name; name it for what belongs in it`,
        });
      } else if (segment === "testing" && index > 0) {
        findings.set(folder, {
          rule: "testing-placement",
          severity: "error",
          files: [folder],
          message: "test doubles belong in the single src/testing/ folder",
        });
      } else if (segment === "integration") {
        findings.set(folder, {
          rule: "integration-placement",
          severity: "error",
          files: [folder],
          message:
            "integration suites live in <workspace>/integration/, outside src/",
        });
      }
    });
  }
  return [...findings.values()];
}

/** Nesting beyond `src/<domain>/<capability>/` needs a capability that meets the grouping rule. */
export function checkNestingDepth(files) {
  const deep = new Set();
  for (const file of files) {
    if (isTestingFile(file)) continue;
    const segments = folderSegments(file.srcPath);
    if (segments.length > 2) {
      deep.add(`${file.workspace}/src/${segments.join("/")}/`);
    }
  }
  return [...deep].map((folder) => ({
    rule: "nesting-depth",
    severity: "review",
    files: [folder],
    message:
      "nested deeper than src/<domain>/<capability>/; allowed only when the capability itself meets the grouping rule",
  }));
}

/**
 * A flat folder with more than eight counted source files must be grouped;
 * one with more than four must be grouped if they span several capabilities.
 */
export function checkGrouping(files) {
  const folders = new Map();
  for (const file of files) {
    if (isTestingFile(file)) continue;
    const segments = folderSegments(file.srcPath);
    // Every ancestor folder learns whether it has subfolders.
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const key = `${file.workspace}/src/${segments.slice(0, depth).join("/")}/`;
      const folder = folders.get(key) ?? { counted: 0, hasSubfolders: false };
      if (depth < segments.length) folder.hasSubfolders = true;
      else if (isCountedSourceFile(file)) folder.counted += 1;
      folders.set(key, folder);
    }
  }

  const findings = [];
  for (const [folder, { counted, hasSubfolders }] of folders) {
    if (hasSubfolders) continue;
    if (counted > FLAT_ERROR_LIMIT) {
      findings.push({
        rule: "grouping",
        severity: "error",
        files: [folder],
        message: `${counted} source files in a flat folder; group them into capability subfolders`,
      });
    } else if (counted > FLAT_REVIEW_LIMIT) {
      findings.push({
        rule: "grouping",
        severity: "review",
        files: [folder],
        message: `${counted} source files in a flat folder; group them if they serve more than one capability`,
      });
    }
  }
  return findings;
}

/** Build configs exclude tests and `src/testing/` with the same patterns everywhere. */
export function checkBuildExcludes(inventory) {
  const findings = [];
  for (const workspace of inventory.workspaces) {
    const config = workspace.buildConfig;
    if (config === undefined) continue;
    const excludes = config.json.exclude ?? [];
    const hasTesting = inventory.files.some(
      (file) => file.workspace === workspace.name && isTestingFile(file),
    );

    if (!excludes.includes(CANONICAL_TEST_EXCLUDE)) {
      findings.push({
        rule: "build-excludes",
        severity: "error",
        files: [config.path],
        message: `exclude must contain "${CANONICAL_TEST_EXCLUDE}"`,
      });
    }
    if (hasTesting && !excludes.includes(CANONICAL_TESTING_EXCLUDE)) {
      const near = excludes.some((pattern) => pattern.includes("testing"));
      findings.push({
        rule: "build-excludes",
        severity: near ? "review" : "error",
        files: [config.path],
        message: near
          ? `exclude src/testing/ with the shared pattern "${CANONICAL_TESTING_EXCLUDE}"`
          : `exclude must contain "${CANONICAL_TESTING_EXCLUDE}"; test doubles must not ship`,
      });
    }
  }
  return findings;
}

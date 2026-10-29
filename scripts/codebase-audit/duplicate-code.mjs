// Finds copied code with jscpd. A copy across packages breaks the AGENTS.md
// rule "Never copy code between packages"; a copy inside one package is a
// review item, because KISS can outrank DRY.
//
// Test suites (`*.test.ts` and the browser suites, `*.browser.ts`) are not
// scanned: at this threshold they hold hundreds of short
// arrange-and-assert repeats, all under 25 lines, which would bury the
// findings that matter. Repeated setup across suites is the codebase-audit
// skill's manual check. Test doubles in `src/testing/` and the helpers of
// opt-in suites in `integration/` are scanned like production code. Folders
// whose copies are the convention, such as migrations that each keep their
// own DDL so applied history never shifts, are left out by path through
// `duplicateCodeExcludedPaths` in audit-exceptions.json.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { isExcluded, toPosix } from "./inventory.mjs";

const MIN_TOKENS = 50;
const SCANNED_FOLDERS = ["src", "integration"];
const IGNORED = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.browser.ts",
  "**/dist/**",
];

/** Runs jscpd over every workspace's `src/` and `integration/` and converts clones to findings. */
export function checkDuplicates(repoRoot, inventory, excludedPaths = []) {
  const paths = inventory.workspaces
    .flatMap((workspace) =>
      SCANNED_FOLDERS.map((folder) => join(repoRoot, workspace.name, folder)),
    )
    .filter((path) => existsSync(path));
  const outputDir = mkdtempSync(join(tmpdir(), "krazitv-audit-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        jscpdBin(),
        ...paths,
        "--format",
        "typescript",
        "--min-tokens",
        String(MIN_TOKENS),
        "--ignore",
        IGNORED.join(","),
        "--reporters",
        "json",
        "--output",
        outputDir,
        "--absolute",
        "--silent",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`jscpd failed: ${result.stderr || result.stdout}`);
    }
    const report = JSON.parse(
      readFileSync(join(outputDir, "jscpd-report.json"), "utf8"),
    );
    return findingsFromClones(repoRoot, report.duplicates, excludedPaths);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

/** Resolves the jscpd CLI from this repo's dependencies, never a global install. */
function jscpdBin() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("jscpd/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin.jscpd;
  return join(dirname(manifestPath), bin);
}

/**
 * Converts jscpd clones to findings, dropping every clone that touches an
 * excluded path, so a folder whose copies are the convention is never
 * reported pair by pair.
 */
export function findingsFromClones(repoRoot, clones, excludedPaths) {
  return clones
    .map((clone) => toFinding(repoRoot, clone))
    .filter(
      (finding) =>
        !finding.files.some((path) => isExcluded(path, excludedPaths)),
    );
}

/** Converts a jscpd path, which may use Windows' `\\?\` long-path prefix, to repo-relative form. */
function toRepoPath(repoRoot, name) {
  return toPosix(relative(repoRoot, name.replace(/^\\\\\?\\/, "")));
}

/** Classifies one clone by whether it crosses a workspace boundary. */
function toFinding(repoRoot, clone) {
  const first = toRepoPath(repoRoot, clone.firstFile.name);
  const second = toRepoPath(repoRoot, clone.secondFile.name);
  const crossesPackages = workspaceOf(first) !== workspaceOf(second);
  return {
    rule: crossesPackages ? "cross-package-copy" : "duplicate-code",
    severity: crossesPackages ? "error" : "review",
    files: [first, second],
    message: `${clone.lines} duplicated lines: ${first}:${clone.firstFile.start}-${clone.firstFile.end} and ${second}:${clone.secondFile.start}-${clone.secondFile.end}`,
  };
}

/** The `apps/<name>` or `packages/<name>` prefix of a repo-relative path. */
function workspaceOf(path) {
  return path.split("/").slice(0, 2).join("/");
}

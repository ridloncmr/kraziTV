// Finds copied code with jscpd. A copy across packages breaks the AGENTS.md
// rule "Never copy code between packages"; a copy inside one package is a
// review item, because KISS can outrank DRY.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { toPosix } from "./inventory.mjs";

const MIN_TOKENS = 50;
const IGNORED = ["**/*.test.ts", "**/*.test.tsx", "**/dist/**"];

/** Runs jscpd over every workspace's `src/` and converts clones to findings. */
export function checkDuplicates(repoRoot, inventory) {
  const paths = inventory.workspaces.map((workspace) =>
    join(repoRoot, workspace.name, "src"),
  );
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
    return report.duplicates.map((clone) => toFinding(repoRoot, clone));
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

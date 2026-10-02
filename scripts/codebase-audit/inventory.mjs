// Collects every workspace's `src/` files so audit rules run as pure checks
// over one in-memory snapshot instead of touching the filesystem themselves.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WORKSPACE_GROUPS = ["apps", "packages"];
const SOURCE_FILE = /\.tsx?$/;
const SKIPPED_DIRS = new Set(["dist", "node_modules", "coverage"]);

/** Converts a native path to the forward-slash form every finding uses. */
export function toPosix(path) {
  return path.split(sep).join("/");
}

/** Whether a repo-relative path falls under any excluded path prefix. */
export function isExcluded(path, excludedPaths) {
  return excludedPaths.some((prefix) => path.startsWith(prefix));
}

/**
 * Reads every workspace that has a `package.json`, its `src/` TypeScript
 * files, and its `tsconfig.build.json` when present.
 */
export function loadInventory(repoRoot, { excludedPaths = [] } = {}) {
  const workspaces = [];
  const files = [];

  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspace = `${group}/${entry.name}`;
      const workspaceDir = join(groupDir, entry.name);
      if (!existsSync(join(workspaceDir, "package.json"))) continue;
      if (isExcluded(`${workspace}/`, excludedPaths)) continue;

      const buildConfigPath = join(workspaceDir, "tsconfig.build.json");
      workspaces.push({
        name: workspace,
        buildConfig: existsSync(buildConfigPath)
          ? {
              path: `${workspace}/tsconfig.build.json`,
              json: JSON.parse(readFileSync(buildConfigPath, "utf8")),
            }
          : undefined,
      });

      const srcDir = join(workspaceDir, "src");
      for (const absolute of walk(srcDir)) {
        const srcPath = toPosix(relative(srcDir, absolute));
        files.push({
          path: `${workspace}/src/${srcPath}`,
          workspace,
          srcPath,
          content: readFileSync(absolute, "utf8"),
        });
      }
    }
  }

  return { workspaces, files };
}

/** Yields every TypeScript file below a directory, skipping build output. */
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(full);
    } else if (SOURCE_FILE.test(entry.name)) {
      yield full;
    }
  }
}

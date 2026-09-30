import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, parse } from "node:path";

import {
  currentPathPlatform,
  normalizeMediaPath,
  type NormalizedMediaPath,
  type PathPlatform,
} from "../paths/media-path.js";
import { MediaDiscoveryError } from "./media-discovery-error.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".m4v",
  ".avi",
  ".mov",
  ".ts",
  ".webm",
]);

// Windows creates these at every volume root and restricts their contents, so
// traversing them would fail any scan of a whole drive, even one mounted on POSIX.
const OS_VOLUME_FOLDERS = new Set([
  "system volume information",
  "$recycle.bin",
]);

export interface DiscoveredMediaFile extends NormalizedMediaPath {
  /** MVP display title: the filename without its final extension. */
  title: string;
}

export interface DiscoverMediaFilesOptions {
  signal?: AbortSignal;
}

/**
 * Lists every supported media file below an accessible root, ordered by identity
 * key. Hidden entries and directory links are skipped; any traversal error or
 * cancellation fails the whole call so callers never act on a partial listing.
 */
export async function discoverMediaFiles(
  rootPath: string,
  options: DiscoverMediaFilesOptions = {},
): Promise<DiscoveredMediaFile[]> {
  const platform = currentPathPlatform();
  const root = normalizeMediaPath(rootPath, platform);
  if (!root) {
    throw new MediaDiscoveryError(
      "invalid_root_path",
      `Media root is not an absolute path: ${rootPath}`,
      rootPath,
    );
  }

  await assertDirectory(root.path, options.signal);

  const files: DiscoveredMediaFile[] = [];
  await collect(root, platform, files, options.signal);
  // An abort during the last filesystem call must still reject.
  throwIfCancelled(options.signal, root.path);
  return files.sort((a, b) => compareOrdinal(a.pathKey, b.pathKey));
}

// The root itself may be a link because it was configured explicitly.
async function assertDirectory(path: string, signal?: AbortSignal) {
  throwIfCancelled(signal, path);
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(path)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new MediaDiscoveryError(
        "root_not_found",
        `Media root does not exist: ${path}`,
        path,
        { cause: error },
      );
    }
    throw traversalFailed(path, error);
  }

  if (!isDirectory) {
    throw new MediaDiscoveryError(
      "root_not_directory",
      `Media root is not a directory: ${path}`,
      path,
    );
  }
}

// Depth-first and sequential: ordering comes from the final sort, not traversal.
async function collect(
  directory: NormalizedMediaPath,
  platform: PathPlatform,
  files: DiscoveredMediaFile[],
  signal?: AbortSignal,
) {
  throwIfCancelled(signal, directory.path);
  let entries: Dirent[];
  try {
    entries = await readdir(directory.path, { withFileTypes: true });
  } catch (error) {
    throw traversalFailed(directory.path, error);
  }

  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      OS_VOLUME_FOLDERS.has(entry.name.toLowerCase())
    ) {
      continue;
    }

    // Names Windows would alias to another path cannot get a trustworthy key.
    const child = normalizeMediaPath(
      join(directory.path, entry.name),
      platform,
    );
    if (!child) {
      continue;
    }

    if (entry.isDirectory()) {
      await collect(child, platform, files, signal);
    } else if (
      SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()) &&
      (entry.isFile() ||
        (entry.isSymbolicLink() && (await isFileLink(child.path, signal))))
    ) {
      files.push({ ...child, title: parse(entry.name).name });
    }
  }
}

// Only file links are followed; dangling links are skipped like absent files.
async function isFileLink(path: string, signal?: AbortSignal) {
  throwIfCancelled(signal, path);
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ELOOP") {
      return false;
    }
    throw traversalFailed(path, error);
  }
}

// Cancellation is cooperative, checked before each filesystem operation.
function throwIfCancelled(signal: AbortSignal | undefined, path: string) {
  if (signal?.aborted) {
    throw new MediaDiscoveryError(
      "cancelled",
      "Media discovery was cancelled",
      path,
      { cause: signal.reason },
    );
  }
}

// Wraps OS errors so callers see one discovery failure type.
function traversalFailed(path: string, cause: unknown) {
  return new MediaDiscoveryError(
    "traversal_failed",
    `Could not read media path: ${path}`,
    path,
    { cause },
  );
}

// Locale collation varies by environment; code-unit order does not.
function compareOrdinal(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

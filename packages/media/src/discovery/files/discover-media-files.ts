import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, parse } from "node:path";

import {
  currentPathPlatform,
  normalizeMediaPath,
  type NormalizedMediaPath,
  type PathPlatform,
} from "../../paths/media-path.js";
import { compareOrdinal, isSkippedEntry } from "../directory-entries.js";
import { MediaDiscoveryError } from "../media-discovery-error.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".m4v",
  ".avi",
  ".mov",
  ".ts",
  ".webm",
]);

export interface DiscoveredMediaFile extends NormalizedMediaPath {
  /**
   * The filename without its final extension: the display title when path
   * hints cannot name the file better.
   */
  title: string;
}

export interface DiscoverMediaFilesOptions {
  signal?: AbortSignal;
  /** Called with the running count of supported files found so far, for progress only. */
  onDiscovered?: (count: number) => void;
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
  await collect(root, platform, files, options);
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
  options: DiscoverMediaFilesOptions,
) {
  const { signal } = options;
  throwIfCancelled(signal, directory.path);
  let entries: Dirent[];
  try {
    entries = await readdir(directory.path, { withFileTypes: true });
  } catch (error) {
    throw traversalFailed(directory.path, error);
  }

  for (const entry of entries) {
    if (isSkippedEntry(entry.name)) {
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
      await collect(child, platform, files, options);
    } else if (
      SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()) &&
      (entry.isFile() ||
        (entry.isSymbolicLink() && (await isFileLink(child.path, signal))))
    ) {
      files.push({ ...child, title: parse(entry.name).name });
      options.onDiscovered?.(files.length);
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

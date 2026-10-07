import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  currentPathPlatform,
  normalizeMediaPath,
} from "../../paths/media-path.js";
import { compareOrdinal, isSkippedEntry } from "../directory-entries.js";
import { driveRoots } from "./drive-roots.js";
import { MediaDiscoveryError } from "../media-discovery-error.js";

interface MediaFolder {
  name: string;
  /** Normalized absolute path, ready to register as a media root. */
  path: string;
}

interface MediaFolderListing {
  /** The listed folder, or null for the server's top level. */
  path: string | null;
  /** The folder above `path`, or null when going up reaches the top level. */
  parent: string | null;
  folders: MediaFolder[];
}

/**
 * Lists the folders directly inside `path` so a user can pick a media root
 * without typing it. Without a path it lists the top level: drive roots on
 * Windows and `/` elsewhere. Folders are listed the way discovery would
 * traverse them, so hidden folders, links, and names without a trustworthy
 * identity are left out.
 */
export async function listMediaFolders(
  path?: string,
): Promise<MediaFolderListing> {
  const platform = currentPathPlatform();
  if (path === undefined) {
    const roots = platform === "win32" ? await driveRoots() : ["/"];
    return {
      path: null,
      parent: null,
      folders: roots.map((root) => ({ name: root, path: root })),
    };
  }

  const folder = normalizeMediaPath(path, platform);
  if (!folder) {
    throw new MediaDiscoveryError(
      "invalid_root_path",
      `Folder is not an absolute path: ${path}`,
      path,
    );
  }

  const folders: MediaFolder[] = [];
  for (const entry of await readFolder(folder.path)) {
    const child = normalizeMediaPath(join(folder.path, entry.name), platform);
    if (entry.isDirectory() && !isSkippedEntry(entry.name) && child) {
      folders.push({ name: entry.name, path: child.path });
    }
  }
  const parent = dirname(folder.path);
  return {
    path: folder.path,
    parent: parent === folder.path ? null : parent,
    // Case-insensitive first so "alpha" and "Beta" read alphabetically.
    folders: folders.sort(
      (a, b) =>
        compareOrdinal(a.name.toLowerCase(), b.name.toLowerCase()) ||
        compareOrdinal(a.name, b.name),
    ),
  };
}

// Maps OS errors onto discovery's codes so callers handle one failure type.
async function readFolder(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new MediaDiscoveryError(
        "root_not_found",
        `Folder does not exist: ${path}`,
        path,
        { cause: error },
      );
    }
    if (code === "ENOTDIR") {
      throw new MediaDiscoveryError(
        "root_not_directory",
        `Not a folder: ${path}`,
        path,
        { cause: error },
      );
    }
    throw new MediaDiscoveryError(
      "traversal_failed",
      `Could not read folder: ${path}`,
      path,
      { cause: error },
    );
  }
}

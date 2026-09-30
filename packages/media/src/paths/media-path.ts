import { posix, win32 } from "node:path";

export type PathPlatform = "win32" | "posix";

export interface NormalizedMediaRootPath {
  /** Normalized absolute path shown to users, preserving original casing. */
  path: string;
  /** Platform-aware comparison key that decides whether two roots are the same. */
  pathKey: string;
}

// A drive root (C:\) or a complete UNC share root (\\server\share\), excluding
// the \\?\ and \\.\ device namespaces.
const WINDOWS_ROOT = /^(?:[A-Za-z]:\\|\\\\(?![?.]\\)[^\\]+\\[^\\]+\\)$/;

// Win32 silently strips trailing dots and spaces, and ":" selects a data stream,
// so such components would alias another directory under a different key.
const AMBIGUOUS_WINDOWS_COMPONENT = /[. ]$|:/;

/** Selects identity rules for the OS whose filesystem the server actually scans. */
export function currentPathPlatform(): PathPlatform {
  return process.platform === "win32" ? "win32" : "posix";
}

/**
 * Lexically normalizes an absolute root path without touching the filesystem, so
 * missing or offline roots can still be registered. Returns undefined for input
 * that is not a fully qualified absolute path on the given platform.
 */
export function normalizeMediaRootPath(
  input: string,
  platform: PathPlatform,
): NormalizedMediaRootPath | undefined {
  if (input.length === 0 || input.includes("\0")) {
    return undefined;
  }

  return platform === "win32"
    ? normalizeWindowsPath(input)
    : normalizePosixPath(input);
}

// Rejects driveless, device, and aliasing paths so one directory has one identity key.
function normalizeWindowsPath(
  input: string,
): NormalizedMediaRootPath | undefined {
  const normalized = win32.normalize(input);
  const { root } = win32.parse(normalized);
  if (!WINDOWS_ROOT.test(root)) {
    return undefined;
  }

  const components = normalized.slice(root.length).split("\\");
  if (components.some((part) => AMBIGUOUS_WINDOWS_COMPONENT.test(part))) {
    return undefined;
  }

  const path = uppercaseDrive(stripTrailingSeparators(normalized, root, "\\"));
  return { path, pathKey: path.toLowerCase() };
}

// POSIX identity stays case-sensitive because the filesystem usually is.
function normalizePosixPath(
  input: string,
): NormalizedMediaRootPath | undefined {
  if (!posix.isAbsolute(input)) {
    return undefined;
  }

  const path = stripTrailingSeparators(posix.normalize(input), "/", "/");
  return { path, pathKey: path };
}

// Makes "C:\TV\" and "C:\TV" one root while keeping a bare root's separator.
function stripTrailingSeparators(
  path: string,
  root: string,
  separator: string,
): string {
  let end = path.length;
  while (end > root.length && path[end - 1] === separator) {
    end -= 1;
  }
  return path.slice(0, end);
}

// Displays drive letters consistently regardless of how the user typed them.
function uppercaseDrive(path: string): string {
  return /^[a-z]:/.test(path) ? path[0]!.toUpperCase() + path.slice(1) : path;
}

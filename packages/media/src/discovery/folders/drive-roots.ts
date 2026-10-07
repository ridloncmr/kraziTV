import { stat } from "node:fs/promises";

const DRIVE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Long enough for a sleeping local disk to answer, short enough that the
// folder picker never waits on an offline network drive's SMB timeout.
const DRIVE_PROBE_TIMEOUT_MS = 1_500;

/**
 * Lists the Windows drive roots that answer in time. Node has no drive
 * enumeration, so each letter's root is probed; an empty, disconnected, or
 * unresponsive drive is left out, and its path can still be typed. An
 * abandoned probe keeps running until the OS gives up, but nothing waits on it.
 */
export async function driveRoots(
  isDirectory: (path: string) => Promise<boolean> = isDirectoryOnDisk,
  timeoutMs = DRIVE_PROBE_TIMEOUT_MS,
): Promise<string[]> {
  const probes = [...DRIVE_LETTERS].map(async (letter) => {
    const root = `${letter}:\\`;
    return (await answersWithin(isDirectory(root), timeoutMs))
      ? root
      : undefined;
  });
  return (await Promise.all(probes)).filter((root) => root !== undefined);
}

// A failed or late probe counts as absent; the timer never outlives the race.
async function answersWithin(
  probe: Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([probe.catch(() => false), late]);
  } finally {
    clearTimeout(timer);
  }
}

// The production probe: a drive root exists when it stats as a directory.
async function isDirectoryOnDisk(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory();
}

import path from "node:path";

export const DATABASE_FILENAME = "krazitv.sqlite";

/** Resolves the runtime data directory without inspecting or creating it. */
export function resolveDataDirectory(
  configuredPath: string | undefined,
  workingDirectory: string,
): string {
  const selectedPath = configuredPath?.trim() || "data";

  return path.resolve(workingDirectory, selectedPath);
}

/** Keeps the database filename fixed while allowing its parent directory to vary. */
export function resolveDatabasePath(dataDirectory: string): string {
  return path.join(dataDirectory, DATABASE_FILENAME);
}

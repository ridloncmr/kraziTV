import { fileURLToPath } from "node:url";

// Found from this module rather than the working directory, so it is the
// repo-root file whether the server runs from src/ under tsx or from dist/,
// and whether it starts from the repo root or apps/server.
const ENV_FILE_PATH = fileURLToPath(
  new URL("../../../../.env", import.meta.url),
);

/**
 * Loads kraziTV's settings file into `process.env` when it exists, so owners
 * can configure kraziTV by copying `.env.example` to `.env`. Variables
 * already in the environment win, so a shell or service manager can still
 * override the file. Returns the path it read, or undefined when there is
 * no file; any other read or parse failure stops startup.
 */
export function loadEnvFile(filePath = ENV_FILE_PATH): string | undefined {
  try {
    process.loadEnvFile(filePath);
    return filePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

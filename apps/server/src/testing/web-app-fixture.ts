import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTemporaryDirectory } from "./test-environment.js";

export const WEB_APP_INDEX = "<!doctype html><title>kraziTV</title>";
export const WEB_APP_SCRIPT = "console.log('kraziTV');";

/**
 * Writes a built web app shaped like Vite's output, index.html plus hashed
 * files under assets/, with a dotfile beside them that must never be served.
 * cleanUpTestEnvironment removes it.
 */
export async function writeWebAppFixture(): Promise<string> {
  const directory = await createTemporaryDirectory();
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), WEB_APP_INDEX);
  await writeFile(join(directory, "assets", "index-abc123.js"), WEB_APP_SCRIPT);
  await writeFile(join(directory, "assets", ".secret"), "hidden");
  return directory;
}

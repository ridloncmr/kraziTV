// Spec 0004 boundary: kraziBrain decides what plays from plain inputs, so it
// depends on no package and imports no persistence, HTTP, provider, or FFmpeg
// code. The server owns all of that and hands kraziBrain plain values.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL("../package.json", import.meta.url));

// Static imports, re-exports, and dynamic imports, by their module specifier.
const MODULE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

// Lists production source files; tests and test doubles may import test tooling.
async function productionSources(): Promise<string[]> {
  const entries = await readdir(SOURCE_DIRECTORY, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (path) =>
        !path.endsWith(".test.ts") &&
        !relative(SOURCE_DIRECTORY, path).startsWith("testing"),
    );
}

describe("kraziBrain package boundary", () => {
  it("declares no runtime dependencies", async () => {
    const manifest = JSON.parse(await readFile(PACKAGE_JSON, "utf8"));

    expect(manifest).not.toHaveProperty("dependencies");
    expect(manifest).not.toHaveProperty("peerDependencies");
    expect(manifest).not.toHaveProperty("optionalDependencies");
  });

  it("imports only its own modules", async () => {
    const sources = await productionSources();
    expect(sources.length).toBeGreaterThan(0);

    const external: string[] = [];
    for (const path of sources) {
      const text = await readFile(path, "utf8");
      for (const [, specifier] of text.matchAll(MODULE_SPECIFIER)) {
        if (!specifier?.startsWith(".")) {
          external.push(`${relative(SOURCE_DIRECTORY, path)}: ${specifier}`);
        }
      }
    }
    expect(external).toEqual([]);
  });
});

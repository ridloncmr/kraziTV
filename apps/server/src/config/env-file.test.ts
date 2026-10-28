import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnvFile } from "./env-file.js";

describe("loadEnvFile", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "krazitv-env-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads settings from the file and reports where it read them", () => {
    const filePath = path.join(directory, ".env");
    writeFileSync(filePath, "KRAZITV_ENV_FILE_TEST=from-file\n");
    vi.stubEnv("KRAZITV_ENV_FILE_TEST", undefined);

    expect(loadEnvFile(filePath)).toBe(filePath);
    expect(process.env.KRAZITV_ENV_FILE_TEST).toBe("from-file");
  });

  it("keeps a variable already set in the environment", () => {
    const filePath = path.join(directory, ".env");
    writeFileSync(filePath, "KRAZITV_ENV_FILE_TEST=from-file\n");
    vi.stubEnv("KRAZITV_ENV_FILE_TEST", "from-shell");

    loadEnvFile(filePath);

    expect(process.env.KRAZITV_ENV_FILE_TEST).toBe("from-shell");
  });

  it("starts without settings when there is no file", () => {
    expect(loadEnvFile(path.join(directory, ".env"))).toBeUndefined();
  });

  it("reads the repo-root file by default, whatever the working directory", () => {
    const load = vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
    const repoRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../..",
    );

    loadEnvFile();

    expect(load).toHaveBeenCalledWith(path.join(repoRoot, ".env"));
  });
});

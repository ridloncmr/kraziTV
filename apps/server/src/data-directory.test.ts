import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DATABASE_FILENAME,
  resolveDataDirectory,
  resolveDatabasePath,
} from "./data-directory.js";

describe("resolveDataDirectory", () => {
  const workingDirectory = path.resolve("workspace");

  it.each([undefined, "", "   "])(
    "uses the local data directory for %s",
    (configuredPath) => {
      expect(resolveDataDirectory(configuredPath, workingDirectory)).toBe(
        path.join(workingDirectory, "data"),
      );
    },
  );

  it("resolves a relative configured path from the process working directory", () => {
    expect(resolveDataDirectory(" ../state ", workingDirectory)).toBe(
      path.resolve(workingDirectory, "../state"),
    );
  });

  it("preserves an absolute configured location", () => {
    const configuredPath = path.resolve("external-state");

    expect(resolveDataDirectory(configuredPath, workingDirectory)).toBe(
      configuredPath,
    );
  });
});

describe("resolveDatabasePath", () => {
  it("uses the fixed kraziTV database filename", () => {
    const dataDirectory = path.resolve("state");

    expect(DATABASE_FILENAME).toBe("krazitv.sqlite");
    expect(resolveDatabasePath(dataDirectory)).toBe(
      path.join(dataDirectory, "krazitv.sqlite"),
    );
  });
});

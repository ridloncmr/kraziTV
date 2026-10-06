import { describe, expect, it } from "vitest";

import { checkExports, checkPackageExports } from "./export-rules.mjs";

// Builds one inventory file inside packages/demo/src.
function file(srcPath, content, workspace = "packages/demo") {
  return {
    path: `${workspace}/src/${srcPath}`,
    workspace,
    srcPath,
    content,
  };
}

const unused = (files) =>
  checkExports({ workspaces: [], files }).map(
    (f) => `${f.files[0]}:${f.message.split(" ")[0]}`,
  );

describe("unused-export", () => {
  it("flags exports that no other file imports", () => {
    expect(
      unused([
        file(
          "a/clock.ts",
          [
            "export class Clock {}",
            "export interface ClockOptions {}",
            "export const tick = 1, tock = 2;",
            "function helper(): void {}",
            "export { helper };",
          ].join("\n"),
        ),
        file(
          "b/user.ts",
          'import { Clock, type ClockOptions as Options } from "../a/clock.js";\n',
        ),
      ]),
    ).toEqual([
      "packages/demo/src/a/clock.ts:tick",
      "packages/demo/src/a/clock.ts:tock",
      "packages/demo/src/a/clock.ts:helper",
    ]);
  });

  it("counts re-exports, namespace imports, and test imports as uses", () => {
    expect(
      unused([
        file("index.ts", 'export { Clock } from "./a/clock.js";\n'),
        file("a/clock.ts", "export class Clock {}\n"),
        file("b/all.ts", "export const one = 1;\nexport const two = 2;\n"),
        file("b/user.ts", 'import * as all from "./all.js";\n'),
        file("c/star.ts", "export const three = 3;\n"),
        file("c/index.ts", 'export * from "./star.js";\n'),
        file("d/only-tested.ts", "export function check(): void {}\n"),
        file(
          "d/only-tested.test.ts",
          'import { check } from "./only-tested.js";\n',
        ),
      ]),
    ).toEqual([]);
  });

  it("skips src root entry points and test support files", () => {
    expect(
      unused([
        file("index.ts", "export const surface = 1;\n"),
        file("create-thing.ts", "export function createThing(): void {}\n"),
        file("testing/fake-clock.ts", "export class FakeClock {}\n"),
        file("a/b.test.ts", "export const fixture = 1;\n"),
      ]),
    ).toEqual([]);
  });
});

describe("unused-package-export", () => {
  /** Supplies a real package name and keeps consumer-only suites out of source rules. */
  function inventory(files, consumerFiles = files) {
    return {
      workspaces: [{ name: "packages/demo", packageName: "@krazitv/demo" }],
      files,
      consumerFiles,
    };
  }

  it("flags named re-exports and declarations, using their public aliases", () => {
    const result = checkPackageExports(
      inventory([
        file(
          "index.ts",
          'export { Clock as PublicClock, type Options } from "./clock.js";\nexport const unused = 1;',
        ),
        file("clock.ts", "export class Clock {}\nexport interface Options {}"),
        file(
          "app.ts",
          'import { PublicClock as Clock } from "@krazitv/demo";',
          "apps/server",
        ),
      ]),
    );
    expect(result.map((finding) => finding.symbol)).toEqual([
      "Options",
      "unused",
    ]);
    expect(result[0]).toMatchObject({
      rule: "unused-package-export",
      severity: "error",
      line: 1,
      files: ["packages/demo/src/index.ts"],
    });
  });

  it("does not let internal imports or same-workspace contract tests justify public surface", () => {
    expect(
      checkPackageExports(
        inventory([
          file("index.ts", 'export { Clock } from "./clock.js";'),
          file("clock.ts", "export class Clock {}"),
          file("testing/contracts.ts", 'import { Clock } from "../index.js";'),
          file("own.test.ts", 'import { Clock } from "@krazitv/demo";'),
        ]),
      ).map((finding) => finding.symbol),
    ).toEqual(["Clock"]);
  });

  it("counts external type imports and named re-exports", () => {
    expect(
      checkPackageExports(
        inventory([
          file(
            "index.ts",
            "export interface Options {}\nexport const Clock = 1;",
          ),
          file(
            "ports/contracts.ts",
            'import type { Options as Settings } from "@krazitv/demo";\nexport { Clock as PublicClock } from "@krazitv/demo";',
            "packages/consumer",
          ),
        ]),
      ),
    ).toEqual([]);
  });

  it("counts opt-in integration suites and excluded workspaces as consumers", () => {
    const entry = file("index.ts", "export const Clock = 1, Options = 2;");
    const integration = {
      ...file(
        "real.test.ts",
        'import { Clock } from "@krazitv/demo";',
        "packages/consumer",
      ),
      path: "packages/consumer/integration/real.test.ts",
    };
    const excludedWorkspace = file(
      "runtime.ts",
      'import { Options } from "@krazitv/demo";',
      "apps/prototype",
    );
    expect(
      checkPackageExports(
        inventory([entry], [entry, integration, excludedWorkspace]),
      ),
    ).toEqual([]);
  });

  it("counts relative imports of a package entry point from another workspace", () => {
    expect(
      checkPackageExports(
        inventory([
          file("index.ts", "export const Clock = 1;"),
          file(
            "app.ts",
            'import { Clock } from "../../../packages/demo/src/index.js";',
            "apps/server",
          ),
        ]),
      ),
    ).toEqual([]);
  });

  it("conservatively counts namespace imports and star re-exports", () => {
    for (const content of [
      'import * as demo from "@krazitv/demo";',
      'export * from "@krazitv/demo";',
    ]) {
      expect(
        checkPackageExports(
          inventory([
            file("index.ts", "export const Clock = 1;"),
            file("app.ts", content, "apps/server"),
          ]),
        ),
      ).toEqual([]);
    }
  });

  it("does not count side-effect imports or similarly named packages", () => {
    expect(
      checkPackageExports(
        inventory([
          file("index.ts", "export const Clock = 1;"),
          file(
            "app.ts",
            'import "@krazitv/demo";\nimport { Clock } from "@krazitv/demo-other";',
            "apps/server",
          ),
        ]),
      ).map((finding) => finding.symbol),
    ).toEqual(["Clock"]);
  });

  it("checks default and namespace export names", () => {
    expect(
      checkPackageExports(
        inventory([
          file(
            "index.ts",
            'export default 1;\nexport * as clocks from "./clock.js";',
          ),
          file("app.ts", 'import demo from "@krazitv/demo";', "apps/server"),
        ]),
      ).map((finding) => finding.symbol),
    ).toEqual(["clocks"]);
  });

  it("counts import types without treating every named export as used", () => {
    expect(
      checkPackageExports(
        inventory([
          file(
            "index.ts",
            "export interface Options {}\nexport const Clock = 1;",
          ),
          file(
            "app.ts",
            'type Settings = import("@krazitv/demo").Options;',
            "apps/server",
          ),
        ]),
      ).map((finding) => finding.symbol),
    ).toEqual(["Clock"]);
  });

  it("conservatively counts dynamic imports as consumers", () => {
    expect(
      checkPackageExports(
        inventory([
          file("index.ts", "export const Clock = 1;"),
          file(
            "app.ts",
            'const demo = await import("@krazitv/demo");',
            "apps/server",
          ),
        ]),
      ),
    ).toEqual([]);
  });
});

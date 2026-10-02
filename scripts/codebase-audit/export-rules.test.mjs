import { describe, expect, it } from "vitest";

import { checkExports } from "./export-rules.mjs";

// Builds one inventory file inside packages/demo/src.
function file(srcPath, content) {
  return {
    path: `packages/demo/src/${srcPath}`,
    workspace: "packages/demo",
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

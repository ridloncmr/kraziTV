import { describe, expect, it } from "vitest";

import { checkModules } from "./module-rules.mjs";

// Builds one inventory file inside packages/demo/src.
function file(srcPath, content) {
  return {
    path: `packages/demo/src/${srcPath}`,
    workspace: "packages/demo",
    srcPath,
    content,
  };
}

// Findings as severity:rule:file, optionally limited to the rule under test.
const rules = (files, only) =>
  checkModules({ workspaces: [], files })
    .filter((f) => only === undefined || f.rule === only)
    .map((f) => `${f.severity}:${f.rule}:${f.files[0]}`);

describe("one-class-per-file", () => {
  it("flags two concrete classes but lets error classes share a file", () => {
    expect(
      rules([
        file("a/two.ts", "export class A {}\nexport class B {}\n"),
        file(
          "a/errors.ts",
          "export class Halted extends Error {}\nexport class Failed extends SignalError {}\n",
        ),
      ]),
    ).toEqual(["error:one-class-per-file:packages/demo/src/a/two.ts"]);
  });
});

describe("private-without-this", () => {
  it("flags only private instance methods that never read this", () => {
    const source = `
export class Worker {
  private count = 0;
  private reads(): number { return this.count; }
  private pure(value: number): number { return value + 1; }
  #hashPure(): number { return 1; }
  private static helper(): number { return 2; }
  private arrowReads(): () => number { return () => this.count; }
}
`;
    expect(
      rules([file("a/worker.ts", source)], "private-without-this"),
    ).toEqual([
      "error:private-without-this:packages/demo/src/a/worker.ts",
      "error:private-without-this:packages/demo/src/a/worker.ts",
    ]);
  });
});

describe("file-size", () => {
  it("asks for review of production files over 500 lines only", () => {
    const long = "const x = 1;\n".repeat(501);
    expect(
      rules([file("a/long.ts", long), file("a/long.test.ts", long)]),
    ).toEqual(["review:file-size:packages/demo/src/a/long.ts"]);
  });
});

describe("test-double-placement", () => {
  it("is an error in production code and a review item in tests", () => {
    expect(
      rules([
        file("a/prod.ts", "export class FakeClock {}\n"),
        file("a/prod.test.ts", "class RecordingLogger {}\n"),
        file("testing/fake-clock.ts", "export class FakeClock {}\n"),
      ]),
    ).toEqual([
      "error:test-double-placement:packages/demo/src/a/prod.ts",
      "review:test-double-placement:packages/demo/src/a/prod.test.ts",
    ]);
  });
});

describe("root-entry-import", () => {
  it("flags domain files importing a src root entry point but not errors.ts", () => {
    expect(
      rules([
        file("a/b.ts", 'import { x } from "../index.js";\n'),
        file("a/c.ts", 'import { y } from "../create-thing.js";\n'),
        file("a/d.ts", 'import { SignalError } from "../errors.js";\n'),
      ]),
    ).toEqual([
      "error:root-entry-import:packages/demo/src/a/b.ts",
      "error:root-entry-import:packages/demo/src/a/c.ts",
    ]);
  });
});

describe("shared-type-placement", () => {
  const writer = file(
    "scan/writer/writer.ts",
    "export interface Generation {}\nexport class Writer {}\n",
  );

  it("asks for review when a capability imports another's non-class type", () => {
    expect(
      rules([
        writer,
        file(
          "scan/scanner/scanner.ts",
          'import type { Generation, Writer } from "../writer/writer.js";\n',
        ),
      ]),
    ).toEqual([
      "review:shared-type-placement:packages/demo/src/scan/scanner/scanner.ts",
    ]);
  });

  it("allows class types, contracts, schema folders, and same-capability imports", () => {
    expect(
      rules([
        writer,
        file("scan/contracts.ts", "export type Summary = {};\n"),
        file("scan/schema/table.ts", "export interface Table {}\n"),
        file(
          "scan/routes/routes.ts",
          [
            'import type { Writer } from "../writer/writer.js";',
            'import type { Summary } from "../contracts.js";',
            'import type { Table } from "../schema/table.js";',
            "",
          ].join("\n"),
        ),
        file(
          "scan/writer/other.ts",
          'import type { Generation } from "./writer.js";\n',
        ),
      ]),
    ).toEqual([]);
  });
});

describe("missing-method-comment", () => {
  it("flags uncommented callables with bodies in production code only", () => {
    const source = `
/** Commented. */
export function documented(): void {}
export function bare(): void {}
export function overload(value: string): void;
/** Commented implementation. */
export function overload(value: unknown): void {}
export class Clock {
  /** Commented. */
  constructor() {}
  private tick(): void { this.now(); }
  /** Commented. */
  now(): number { return 0; }
}
export const arrow = (): void => {};
`;
    expect(
      rules([
        file("a/clock.ts", source),
        file("a/clock.test.ts", "function helper(): void {}\n"),
        file("testing/fake.ts", "export function fake(): void {}\n"),
      ]),
    ).toEqual([
      "error:missing-method-comment:packages/demo/src/a/clock.ts",
      "error:missing-method-comment:packages/demo/src/a/clock.ts",
    ]);
  });
});

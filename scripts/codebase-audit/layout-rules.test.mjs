import { describe, expect, it } from "vitest";

import {
  checkBuildExcludes,
  checkFolderNames,
  checkGrouping,
  checkNestingDepth,
  checkSrcRoot,
} from "./layout-rules.mjs";

// Builds one inventory file inside packages/demo/src.
function file(srcPath, content = "") {
  return {
    path: `packages/demo/src/${srcPath}`,
    workspace: "packages/demo",
    srcPath,
    content,
  };
}

const rules = (findings) =>
  findings.map((f) => `${f.severity}:${f.rule}:${f.files[0]}`);

describe("checkSrcRoot", () => {
  it("allows entry points and the tests beside them", () => {
    const files = [
      "index.ts",
      "errors.ts",
      "app.ts",
      "main.tsx",
      "create-thing.ts",
      "create-thing.test.ts",
      "create-thing.scenarios.test.ts",
      "index.test.ts",
    ].map((name) => file(name));

    expect(checkSrcRoot(files)).toEqual([]);
  });

  it("flags implementation at the src root", () => {
    expect(
      rules(checkSrcRoot([file("helpers.ts"), file("loose.test.ts")])),
    ).toEqual([
      "error:src-root:packages/demo/src/helpers.ts",
      "error:src-root:packages/demo/src/loose.test.ts",
    ]);
  });
});

describe("checkFolderNames", () => {
  it("flags vague, nested testing, and in-src integration folders once each", () => {
    const files = [
      file("utils/a.ts"),
      file("utils/b.ts"),
      file("probe/testing/fake.ts"),
      file("integration/real.test.ts"),
      file("testing/fake.ts"),
    ];

    expect(rules(checkFolderNames(files))).toEqual([
      "error:vague-folder:packages/demo/src/utils/",
      "error:testing-placement:packages/demo/src/probe/testing/",
      "error:integration-placement:packages/demo/src/integration/",
    ]);
  });
});

describe("checkNestingDepth", () => {
  it("asks for review beyond domain and capability", () => {
    const files = [file("db/schema/a.ts"), file("db/schema/deep/b.ts")];

    expect(rules(checkNestingDepth(files))).toEqual([
      "review:nesting-depth:packages/demo/src/db/schema/deep/",
    ]);
  });
});

describe("checkGrouping", () => {
  const flat = (count, extra = []) => [
    ...Array.from({ length: count }, (_, i) => file(`domain/f${i}.ts`)),
    ...extra,
  ];

  it("ignores tests and contracts when counting", () => {
    const files = flat(4, [
      file("domain/contracts.ts"),
      file("domain/f0.test.ts"),
    ]);

    expect(checkGrouping(files)).toEqual([]);
  });

  it("asks for review above four and requires grouping above eight", () => {
    expect(rules(checkGrouping(flat(5)))).toEqual([
      "review:grouping:packages/demo/src/domain/",
    ]);
    expect(rules(checkGrouping(flat(9)))).toEqual([
      "error:grouping:packages/demo/src/domain/",
    ]);
  });

  it("treats a domain with capability folders as grouped", () => {
    const files = flat(9, [file("domain/routes/r.ts")]);

    expect(checkGrouping(files)).toEqual([]);
  });
});

describe("checkBuildExcludes", () => {
  const inventory = (exclude) => ({
    workspaces: [
      {
        name: "packages/demo",
        buildConfig: {
          path: "packages/demo/tsconfig.build.json",
          json: { exclude },
        },
      },
    ],
    files: [file("testing/fake.ts")],
  });

  it("accepts the shared patterns", () => {
    expect(
      checkBuildExcludes(
        inventory(["src/**/*.test.ts", "src/testing/**/*.ts"]),
      ),
    ).toEqual([]);
  });

  it("flags a missing testing exclude and asks for review of a near miss", () => {
    expect(rules(checkBuildExcludes(inventory(["src/**/*.test.ts"])))).toEqual([
      "error:build-excludes:packages/demo/tsconfig.build.json",
    ]);
    expect(
      rules(
        checkBuildExcludes(
          inventory(["src/**/*.test.ts", "src/**/testing/**/*.ts"]),
        ),
      ),
    ).toEqual(["review:build-excludes:packages/demo/tsconfig.build.json"]);
  });
});

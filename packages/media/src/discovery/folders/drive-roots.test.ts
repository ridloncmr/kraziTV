import { describe, expect, it } from "vitest";

import { driveRoots } from "./drive-roots.js";

describe("driveRoots", () => {
  it("lists the drives whose roots answer as directories", async () => {
    const present = new Set(["C:\\", "E:\\"]);

    const roots = await driveRoots(async (root) => present.has(root));

    expect(roots).toEqual(["C:\\", "E:\\"]);
  });

  it("leaves out a drive whose probe fails", async () => {
    const roots = await driveRoots(async (root) => {
      if (root === "D:\\") throw new Error("device not ready");
      return root === "C:\\" || root === "D:\\";
    });

    expect(roots).toEqual(["C:\\"]);
  });

  it("leaves out a drive that does not answer in time instead of waiting", async () => {
    const roots = await driveRoots(
      // An offline network drive: its probe never settles.
      (root) =>
        root === "Z:\\"
          ? new Promise(() => {})
          : Promise.resolve(root === "C:\\"),
      10,
    );

    expect(roots).toEqual(["C:\\"]);
  });
});

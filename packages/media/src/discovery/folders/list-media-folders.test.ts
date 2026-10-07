import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listMediaFolders } from "./list-media-folders.js";

const isWindows = process.platform === "win32";

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "krazitv-folders-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

// Creates empty directories relative to the sandbox.
async function createFolders(...relativePaths: string[]) {
  for (const relativePath of relativePaths) {
    await mkdir(join(sandbox, relativePath), { recursive: true });
  }
}

describe("listMediaFolders", () => {
  it("lists child folders case-insensitively with their absolute paths", async () => {
    await createFolders("beta", "Alpha/Nested", "gamma");
    await writeFile(join(sandbox, "episode.mkv"), "");

    const listing = await listMediaFolders(sandbox);

    expect(listing).toEqual({
      path: sandbox,
      parent: parse(sandbox).dir,
      folders: [
        { name: "Alpha", path: join(sandbox, "Alpha") },
        { name: "beta", path: join(sandbox, "beta") },
        { name: "gamma", path: join(sandbox, "gamma") },
      ],
    });
  });

  it("leaves out folders discovery would skip", async () => {
    await createFolders(".hidden", "$RECYCLE.BIN", "Shows");

    const listing = await listMediaFolders(sandbox);

    expect(listing.folders.map((folder) => folder.name)).toEqual(["Shows"]);
  });

  it("leaves out directory links, as discovery does", async (context) => {
    await createFolders("Real");
    try {
      await symlink(join(sandbox, "Real"), join(sandbox, "Linked"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("directory links are not permitted for this user");
      }
      throw error;
    }

    const listing = await listMediaFolders(sandbox);

    expect(listing.folders.map((folder) => folder.name)).toEqual(["Real"]);
  });

  it("normalizes the listed path", async () => {
    await createFolders("Shows");

    const listing = await listMediaFolders(join(sandbox, "Shows", ".."));

    expect(listing.path).toBe(sandbox);
  });

  it("reports no parent at a filesystem root", async () => {
    const root = parse(sandbox).root;

    const listing = await listMediaFolders(root);

    expect(listing.parent).toBeNull();
  });

  it.runIf(isWindows)("lists drive roots at the top level", async () => {
    const listing = await listMediaFolders();

    expect(listing.path).toBeNull();
    expect(listing.folders).toContainEqual({
      name: parse(sandbox).root,
      path: parse(sandbox).root,
    });
  });

  it.runIf(!isWindows)(
    "lists the filesystem root at the top level",
    async () => {
      expect(await listMediaFolders()).toEqual({
        path: null,
        parent: null,
        folders: [{ name: "/", path: "/" }],
      });
    },
  );

  it("fails for a relative path", async () => {
    await expect(listMediaFolders("media/tv")).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "invalid_root_path",
    });
  });

  it("fails when the folder does not exist", async () => {
    await expect(
      listMediaFolders(join(sandbox, "missing")),
    ).rejects.toMatchObject({ code: "root_not_found" });
  });

  it("fails when the path is a file", async () => {
    await writeFile(join(sandbox, "episode.mkv"), "");

    await expect(
      listMediaFolders(join(sandbox, "episode.mkv")),
    ).rejects.toMatchObject({ code: "root_not_directory" });
  });
});

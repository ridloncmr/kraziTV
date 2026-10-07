import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  currentPathPlatform,
  normalizeMediaPath,
} from "../paths/media-path.js";
import { discoverMediaFiles } from "./discover-media-files.js";

const isWindows = process.platform === "win32";

let sandbox: string;
let restoreAccess: (() => void)[];

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "krazitv-discovery-"));
  restoreAccess = [];
});

afterEach(async () => {
  for (const restore of restoreAccess) {
    restore();
  }
  await rm(sandbox, { recursive: true, force: true });
});

// Creates empty files (and their parent directories) relative to a directory.
async function createFiles(base: string, ...relativePaths: string[]) {
  for (const relativePath of relativePaths) {
    const filePath = join(base, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "");
  }
}

// Mirrors the identity the catalog will persist for a sandbox-relative path.
function identityOf(...segments: string[]) {
  const normalized = normalizeMediaPath(
    join(sandbox, ...segments),
    currentPathPlatform(),
  );
  if (!normalized) {
    throw new Error("sandbox path failed to normalize");
  }
  return normalized;
}

// Denies directory listing with the OS mechanism that actually applies.
function makeUnreadable(directory: string) {
  if (isWindows) {
    execFileSync("icacls", [directory, "/deny", "*S-1-1-0:(RD)"]);
    restoreAccess.push(() =>
      execFileSync("icacls", [directory, "/remove:d", "*S-1-1-0"]),
    );
  } else {
    execFileSync("chmod", ["000", directory]);
    restoreAccess.push(() => execFileSync("chmod", ["755", directory]));
  }
}

// Root bypasses POSIX permission bits, so access-denial tests cannot run as root.
const canDenyAccess = isWindows || process.getuid?.() !== 0;

describe("discoverMediaFiles", () => {
  it("returns nested supported files with identities and filename titles", async () => {
    await createFiles(sandbox, "Show/Season 1/Show.S01E01.mkv", "Movie.mp4");

    const files = await discoverMediaFiles(sandbox);

    expect(files).toEqual(
      [
        { ...identityOf("Movie.mp4"), title: "Movie" },
        {
          ...identityOf("Show", "Season 1", "Show.S01E01.mkv"),
          title: "Show.S01E01",
        },
      ].sort((a, b) => (a.pathKey < b.pathKey ? -1 : 1)),
    );
  });

  it("matches supported extensions case-insensitively and ignores others", async () => {
    await createFiles(
      sandbox,
      "a.MKV",
      "b.Mp4",
      "c.m4v",
      "d.avi",
      "e.MOV",
      "f.ts",
      "g.webm",
      "notes.txt",
      "cover.jpg",
      "subtitles.srt",
      "no-extension",
    );

    const titles = (await discoverMediaFiles(sandbox)).map((f) => f.title);

    expect(titles).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("orders results by ordinal identity key comparison", async () => {
    // "é" sorts before "f" under locale collation but after it by code unit.
    await createFiles(sandbox, "é.mkv", "f.mkv", "b.mkv", "D/c.mkv", "_.mkv");

    const files = await discoverMediaFiles(sandbox);
    const keys = files.map((f) => f.pathKey);

    expect(keys).toHaveLength(5);
    expect(keys).toEqual([...keys].sort());
    expect(files.map((f) => f.title).slice(-2)).toEqual(["f", "é"]);
  });

  it("returns the same result for repeated discovery", async () => {
    await createFiles(sandbox, "x/1.mkv", "y/2.mkv", "3.mkv");

    const first = await discoverMediaFiles(sandbox);

    expect(await discoverMediaFiles(sandbox)).toEqual(first);
  });

  it("reports the running count of supported files as each is found", async () => {
    await createFiles(sandbox, "x/1.mkv", "notes.txt", "y/2.mp4", "3.mkv");
    const counts: number[] = [];

    const files = await discoverMediaFiles(sandbox, {
      onDiscovered: (count) => counts.push(count),
    });

    expect(counts).toEqual([1, 2, 3]);
    expect(files).toHaveLength(3);
  });

  it("returns an empty list for an empty root", async () => {
    expect(await discoverMediaFiles(sandbox)).toEqual([]);
  });

  it("skips hidden files and hidden subtrees", async () => {
    await createFiles(
      sandbox,
      "visible.mkv",
      ".hidden.mkv",
      ".trash/deleted.mkv",
      "Show/.cache/Show/episode.mkv",
    );

    const titles = (await discoverMediaFiles(sandbox)).map((f) => f.title);

    expect(titles).toEqual(["visible"]);
  });

  it("skips OS-managed volume folders in any letter case", async () => {
    await createFiles(
      sandbox,
      "kept.mkv",
      "System Volume Information/restore.mkv",
      "$Recycle.Bin/S-1-5-21/deleted.mkv",
      "$RECYCLE.BIN/deleted.mkv",
    );

    const titles = (await discoverMediaFiles(sandbox)).map((f) => f.title);

    expect(titles).toEqual(["kept"]);
  });

  it("allows an explicitly configured dot-prefixed root", async () => {
    await createFiles(sandbox, ".media/episode.mkv");

    const files = await discoverMediaFiles(join(sandbox, ".media"));

    expect(files).toEqual([
      { ...identityOf(".media", "episode.mkv"), title: "episode" },
    ]);
  });

  it("does not follow directory links", async () => {
    await createFiles(sandbox, "outside/linked.mkv", "root/own.mkv");
    await symlink(
      join(sandbox, "outside"),
      join(sandbox, "root", "link"),
      isWindows ? "junction" : "dir",
    );

    const titles = (await discoverMediaFiles(join(sandbox, "root"))).map(
      (f) => f.title,
    );

    expect(titles).toEqual(["own"]);
  });

  it("includes symlinked files with supported extensions", async (context) => {
    await createFiles(sandbox, "outside/target.mkv", "root/.keep");
    try {
      await symlink(
        join(sandbox, "outside", "target.mkv"),
        join(sandbox, "root", "linked.mkv"),
        "file",
      );
    } catch (error) {
      // Windows file symlinks need Developer Mode or elevation.
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("file symlinks are not permitted for this user");
      }
      throw error;
    }

    const files = await discoverMediaFiles(join(sandbox, "root"));

    expect(files).toEqual([
      { ...identityOf("root", "linked.mkv"), title: "linked" },
    ]);
  });

  it.runIf(isWindows)(
    "skips entries whose names have no trustworthy Windows identity",
    async () => {
      await createFiles(sandbox, "kept.mkv", "Show./episode.mkv");

      const titles = (await discoverMediaFiles(sandbox)).map((f) => f.title);

      expect(titles).toEqual(["kept"]);
    },
  );

  it("fails for a relative root path", async () => {
    await expect(discoverMediaFiles("media/tv")).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "invalid_root_path",
    });
  });

  it("fails when the root does not exist", async () => {
    await expect(
      discoverMediaFiles(join(sandbox, "missing")),
    ).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "root_not_found",
    });
  });

  it("fails when the root is a file", async () => {
    await createFiles(sandbox, "file.mkv");

    await expect(
      discoverMediaFiles(join(sandbox, "file.mkv")),
    ).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "root_not_directory",
    });
  });

  it.runIf(canDenyAccess)("fails when the root is unreadable", async () => {
    await createFiles(sandbox, "root/episode.mkv");
    makeUnreadable(join(sandbox, "root"));

    await expect(
      discoverMediaFiles(join(sandbox, "root")),
    ).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "traversal_failed",
      path: identityOf("root").path,
    });
  });

  it.runIf(canDenyAccess)(
    "fails instead of returning partial results for an unreadable nested directory",
    async () => {
      await createFiles(sandbox, "a.mkv", "Locked/b.mkv", "z.mkv");
      makeUnreadable(join(sandbox, "Locked"));

      await expect(discoverMediaFiles(sandbox)).rejects.toMatchObject({
        name: "MediaDiscoveryError",
        code: "traversal_failed",
        path: identityOf("Locked").path,
      });
    },
  );

  it("fails with a cancellation error when the signal is already aborted", async () => {
    await createFiles(sandbox, "episode.mkv");

    await expect(
      discoverMediaFiles(sandbox, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "cancelled",
    });
  });

  it("stops between filesystem operations when cancelled mid-traversal", async () => {
    await createFiles(sandbox, "a/1.mkv", "b/2.mkv", "c/3.mkv");
    const controller = new AbortController();

    const discovery = discoverMediaFiles(sandbox, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(discovery).rejects.toMatchObject({
      name: "MediaDiscoveryError",
      code: "cancelled",
    });
  });
});

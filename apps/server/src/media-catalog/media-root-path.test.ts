import { describe, expect, it } from "vitest";

import { normalizeMediaRootPath } from "./media-root-path.js";

describe("normalizeMediaRootPath on Windows", () => {
  it("gives drive-letter and case variants one identity", () => {
    const variants = [
      "C:\\Media\\TV",
      "c:\\media\\tv",
      "C:/Media/TV/",
      "C:\\Media\\.\\Shows\\..\\TV\\\\",
    ].map((path) => normalizeMediaRootPath(path, "win32"));

    for (const variant of variants) {
      expect(variant?.pathKey).toBe("c:\\media\\tv");
    }
  });

  it("preserves display casing with an uppercase drive letter", () => {
    expect(normalizeMediaRootPath("c:/Media/TV/", "win32")).toEqual({
      path: "C:\\Media\\TV",
      pathKey: "c:\\media\\tv",
    });
  });

  it("keeps the separator of a bare drive root", () => {
    expect(normalizeMediaRootPath("d:/", "win32")).toEqual({
      path: "D:\\",
      pathKey: "d:\\",
    });
  });

  it("accepts UNC share paths", () => {
    expect(normalizeMediaRootPath("\\\\NAS\\Media\\Movies\\", "win32")).toEqual(
      {
        path: "\\\\NAS\\Media\\Movies",
        pathKey: "\\\\nas\\media\\movies",
      },
    );
  });

  it("keeps the separator of a bare UNC share root", () => {
    expect(normalizeMediaRootPath("//NAS/Media", "win32")).toEqual({
      path: "\\\\NAS\\Media\\",
      pathKey: "\\\\nas\\media\\",
    });
  });

  it("accepts a UNC server name that starts with a dot", () => {
    expect(normalizeMediaRootPath("\\\\.nas\\Media", "win32")?.path).toBe(
      "\\\\.nas\\Media\\",
    );
  });

  it.each([
    ["relative", "Media\\TV"],
    ["drive-relative", "C:Media"],
    ["current-drive rooted", "\\Media\\TV"],
    ["POSIX-style rooted", "/media/tv"],
    ["incomplete UNC", "\\\\NAS"],
    ["device namespace", "\\\\?\\C:\\Media"],
    ["device namespace with a dot", "\\\\.\\C:\\Media"],
    ["trailing-dot component", "C:\\Media\\TV."],
    ["trailing-space component", "C:\\Media \\TV"],
    ["stream-suffixed", "C:\\Media\\TV::$DATA"],
    ["empty", ""],
    ["NUL-containing", "C:\\Media\0TV"],
  ])("rejects a %s path", (_label, path) => {
    expect(normalizeMediaRootPath(path, "win32")).toBeUndefined();
  });
});

describe("normalizeMediaRootPath on POSIX", () => {
  it("preserves case-sensitive identity", () => {
    const upper = normalizeMediaRootPath("/mnt/Media/TV", "posix");
    const lower = normalizeMediaRootPath("/mnt/media/tv", "posix");

    expect(upper).toEqual({ path: "/mnt/Media/TV", pathKey: "/mnt/Media/TV" });
    expect(lower?.pathKey).not.toBe(upper?.pathKey);
  });

  it("normalizes lexically without touching the filesystem", () => {
    expect(
      normalizeMediaRootPath("//mnt/./media//shows/../tv/", "posix"),
    ).toEqual({ path: "/mnt/media/tv", pathKey: "/mnt/media/tv" });
  });

  it("keeps the filesystem root", () => {
    expect(normalizeMediaRootPath("/", "posix")).toEqual({
      path: "/",
      pathKey: "/",
    });
  });

  it.each([
    ["relative", "media/tv"],
    ["Windows drive", "C:\\Media"],
    ["empty", ""],
    ["NUL-containing", "/media\0/tv"],
  ])("rejects a %s path", (_label, path) => {
    expect(normalizeMediaRootPath(path, "posix")).toBeUndefined();
  });
});

import { expect, it } from "vitest";
import type { MediaItem } from "../http/contracts.js";
import type { DraftMember } from "./contracts.js";
import { appendMedia, moveMembers, sortMembers } from "./member-order.js";

// Builds a member whose title and path both derive from its ID unless overridden.
function member(id: string, overrides: Partial<DraftMember> = {}): DraftMember {
  return {
    mediaItemId: id,
    title: id,
    path: `/media/${id}.mkv`,
    status: "available",
    durationMs: 1_000,
    ...overrides,
  };
}

const ids = (members: DraftMember[]) => members.map((item) => item.mediaItemId);

const five = ["a", "b", "c", "d", "e"].map((id) => member(id));

it("moves chosen members as a block in their existing relative order", () => {
  expect(ids(moveMembers(five, new Set(["d", "b"]), 0))).toEqual([
    "b",
    "d",
    "a",
    "c",
    "e",
  ]);
  expect(ids(moveMembers(five, new Set(["a", "c"]), Infinity))).toEqual([
    "b",
    "d",
    "e",
    "a",
    "c",
  ]);
});

it("places a moved block at an index among the members left behind", () => {
  expect(ids(moveMembers(five, new Set(["e"]), 1))).toEqual([
    "a",
    "e",
    "b",
    "c",
    "d",
  ]);
  expect(ids(moveMembers(five, new Set(["b"]), 2))).toEqual([
    "a",
    "c",
    "b",
    "d",
    "e",
  ]);
});

it("sorts paths with numeric collation so episode 2 precedes episode 10", () => {
  const members = [
    member("ten", { path: "/tv/Show/Episode 10.mkv" }),
    member("two", { path: "/tv/show/episode 2.mkv" }),
    member("one", { path: "/tv/Show/Episode 1.mkv" }),
  ];
  expect(ids(sortMembers(members, "path"))).toEqual(["one", "two", "ten"]);
});

it("sorts by title with the path breaking ties", () => {
  const members = [
    member("b", { title: "Pilot", path: "/b.mkv" }),
    member("a", { title: "Pilot", path: "/a.mkv" }),
    member("c", { title: "Finale" }),
  ];
  expect(ids(sortMembers(members, "title"))).toEqual(["c", "a", "b"]);
});

it("appends only new media, in path order, after the existing members", () => {
  const media = (id: string, path: string): MediaItem => ({
    id,
    title: id,
    path,
    status: "available",
    durationMs: 1_000,
    probeError: null,
  });
  const added = appendMedia(
    [member("a")],
    [
      media("z", "/s/ep 10.mkv"),
      media("a", "/a.mkv"),
      media("y", "/s/ep 2.mkv"),
    ],
  );
  expect(ids(added)).toEqual(["a", "y", "z"]);
  expect(added[1]).toEqual({
    mediaItemId: "y",
    title: "y",
    path: "/s/ep 2.mkv",
    status: "available",
    durationMs: 1_000,
  });
});

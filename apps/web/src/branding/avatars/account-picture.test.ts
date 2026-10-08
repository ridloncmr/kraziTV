// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AVATAR_IDS, AccountPicture } from "./account-picture.js";

afterEach(cleanup);

/**
 * The drawing inside the frame, as markup with this render's generated id
 * removed, so two renders of the same avatar compare equal and two
 * different avatars compare by what they draw.
 */
function drawingOf(avatarId: string): string {
  const { container } = render(createElement(AccountPicture, { avatarId }));
  const id = container.querySelector("clipPath")!.id.replace(/-tile$/, "");
  const drawing = container.querySelector("[data-avatar]")!;
  return `${drawing.getAttribute("data-avatar")}|${drawing.innerHTML.replaceAll(id, "ID")}`;
}

it("lists the eight built-in avatars with duck, the server default, first", () => {
  expect(AVATAR_IDS).toEqual([
    "duck",
    "crt-tv",
    "antenna",
    "remote",
    "film-reel",
    "popcorn",
    "guitar",
    "chess",
  ]);
});

it("draws a different picture for every built-in avatar", () => {
  const drawings = AVATAR_IDS.map(drawingOf);
  for (const [index, avatarId] of AVATAR_IDS.entries())
    expect(drawings[index]?.startsWith(`${avatarId}|`)).toBe(true);
  // Markup alone, without the label, still differs for every pair.
  const pictures = drawings.map((drawing) => drawing.split("|")[1]);
  expect(new Set(pictures).size).toBe(AVATAR_IDS.length);
  for (const picture of pictures) expect(picture?.length).toBeGreaterThan(200);
});

it("draws the duck for an avatar ID it does not know", () => {
  expect(drawingOf("unicorn")).toBe(drawingOf("duck"));
});

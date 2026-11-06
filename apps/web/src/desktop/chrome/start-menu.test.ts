// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { pressKey } from "../../testing/press-key.js";
import { StartMenu } from "./start-menu.js";

afterEach(cleanup);

/** Renders Start, which focuses My Channels. */
function renderStart() {
  render(
    createElement(StartMenu, {
      avatarId: "astro",
      displayName: "Marguerite",
      openProgram: vi.fn(),
      logOff: vi.fn(),
    }),
  );
}

/** The focused Start entry's program name. */
function focusedName(): string | undefined {
  return document.activeElement?.querySelector("strong")?.textContent;
}

it("moves through a column with Up and Down, wrapping at its ends", () => {
  renderStart();
  expect(focusedName()).toBe("My Channels");

  pressKey("ArrowDown");
  expect(focusedName()).toBe("Media Library");
  pressKey("ArrowUp");
  pressKey("ArrowUp");
  expect(focusedName()).toBe("TV");
  pressKey("ArrowDown");
  expect(focusedName()).toBe("My Channels");
});

it("jumps to a column's first and last entries with Home and End", () => {
  renderStart();
  pressKey("End");
  expect(focusedName()).toBe("TV");
  pressKey("ArrowRight");
  pressKey("Home");
  expect(focusedName()).toBe("Plex Setup");
});

it("switches columns with Left and Right, keeping the row where the other column has one", () => {
  renderStart();
  pressKey("ArrowDown");
  pressKey("ArrowRight");
  expect(focusedName()).toBe("Live Monitor");
  pressKey("ArrowLeft");
  expect(focusedName()).toBe("Media Library");

  // Up from the second row wraps to the last Primary entry, TV, whose row
  // has no Server neighbour, so Right lands on Server's last entry.
  pressKey("ArrowUp");
  pressKey("ArrowUp");
  expect(focusedName()).toBe("TV");
  pressKey("ArrowRight");
  expect(focusedName()).toBe("Account Settings");
  // There is no column past the outer ones, so Right stays put.
  pressKey("ArrowRight");
  expect(focusedName()).toBe("Account Settings");
});

it("leaves other keys, and the footer's buttons, alone", () => {
  renderStart();
  pressKey("Tab");
  expect(focusedName()).toBe("My Channels");
  screen.getByRole("button", { name: "Log Off" }).focus();
  pressKey("ArrowUp");
  expect(document.activeElement?.textContent).toBe("Log Off");
});

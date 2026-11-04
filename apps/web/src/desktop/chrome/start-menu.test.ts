// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StartMenu } from "./start-menu.js";

afterEach(cleanup);

/** Renders Start, which focuses My Channels. */
function renderStart() {
  render(
    createElement(StartMenu, {
      avatarId: "astro",
      openProgram: vi.fn(),
      logOff: vi.fn(),
    }),
  );
}

/** Presses one key on whatever has focus, as a keyboard does. */
function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

/** The focused Start entry's program name. */
function focusedName(): string | undefined {
  return document.activeElement?.querySelector("strong")?.textContent;
}

it("moves through a column with Up and Down, wrapping at its ends", () => {
  renderStart();
  expect(focusedName()).toBe("My Channels");

  press("ArrowDown");
  expect(focusedName()).toBe("Media Library");
  press("ArrowUp");
  press("ArrowUp");
  expect(focusedName()).toBe("TV");
  press("ArrowDown");
  expect(focusedName()).toBe("My Channels");
});

it("switches columns with Left and Right, keeping the row where the other column has one", () => {
  renderStart();
  press("ArrowDown");
  press("ArrowRight");
  expect(focusedName()).toBe("Live Monitor");
  press("ArrowLeft");
  expect(focusedName()).toBe("Media Library");

  // The fifth row has no Server neighbour, so Right lands on the last one.
  press("ArrowUp");
  press("ArrowUp");
  expect(focusedName()).toBe("TV");
  press("ArrowRight");
  expect(focusedName()).toBe("Account Settings");
  // There is no column past the outer ones, so Right stays put.
  press("ArrowRight");
  expect(focusedName()).toBe("Account Settings");
});

it("leaves other keys, and the footer's buttons, alone", () => {
  renderStart();
  press("Tab");
  expect(focusedName()).toBe("My Channels");
  screen.getByRole("button", { name: "Log Off" }).focus();
  press("ArrowUp");
  expect(document.activeElement?.textContent).toBe("Log Off");
});

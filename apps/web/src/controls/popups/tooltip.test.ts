// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { elapse } from "../../testing/fake-time.js";
import { Tooltip } from "./tooltip.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// A row of two tipped buttons, as the taskbar holds.
function renderRow() {
  render(
    createElement(
      "div",
      null,
      createElement(Tooltip, {
        id: "tip-a",
        text: "Configure your channels",
        children: createElement("button", { "aria-describedby": "tip-a" }, "A"),
      }),
      createElement(Tooltip, {
        id: "tip-b",
        text: "Scan local media",
        children: createElement("button", { "aria-describedby": "tip-b" }, "B"),
      }),
    ),
  );
}
const tip = (text: string) => screen.getByRole("tooltip", { name: text });
const host = (text: string) => tip(text).parentElement!;

it("shows a tip after the pointer rests, and the next one at once while reading along", async () => {
  renderRow();
  fireEvent.pointerEnter(host("Configure your channels"));
  expect(tip("Configure your channels").dataset.shown).toBe("false");
  await elapse(499);
  expect(tip("Configure your channels").dataset.shown).toBe("false");
  await elapse(1);
  expect(tip("Configure your channels").dataset.shown).toBe("true");
  expect(tip("Configure your channels").dataset.instant).toBe("false");

  fireEvent.pointerLeave(host("Configure your channels"));
  expect(tip("Configure your channels").dataset.shown).toBe("false");
  fireEvent.pointerEnter(host("Scan local media"));
  expect(tip("Scan local media").dataset.shown).toBe("true");
  expect(tip("Scan local media").dataset.instant).toBe("true");
});

it("waits again once the reading pause has passed, and never shows for a touch", async () => {
  renderRow();
  fireEvent.pointerEnter(host("Configure your channels"));
  await elapse(500);
  fireEvent.pointerLeave(host("Configure your channels"));
  await elapse(501);
  fireEvent.pointerEnter(host("Scan local media"));
  expect(tip("Scan local media").dataset.shown).toBe("false");
  fireEvent.pointerLeave(host("Scan local media"));

  fireEvent.pointerEnter(host("Scan local media"), { pointerType: "touch" });
  await elapse(1000);
  expect(tip("Scan local media").dataset.shown).toBe("false");
});

it("describes its control whether or not it is showing, and hides on press", async () => {
  renderRow();
  const described = screen
    .getByRole("button", { name: "A" })
    .getAttribute("aria-describedby");
  expect(document.getElementById(described!)?.textContent).toBe(
    "Configure your channels",
  );
  fireEvent.pointerEnter(host("Configure your channels"));
  await elapse(500);
  fireEvent.pointerDown(host("Configure your channels"));
  expect(tip("Configure your channels").dataset.shown).toBe("false");
});

// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RowMenu } from "./row-menu.js";

afterEach(cleanup);

// Renders a menu of Enable, a disabled Scan, and Delete…, returning their spies.
function renderMenu() {
  const enable = vi.fn();
  const remove = vi.fn();
  render(
    createElement(RowMenu, {
      label: "Actions for /media",
      items: [
        { label: "Enable", onSelect: enable },
        { label: "Scan", disabled: true, onSelect: vi.fn() },
        { label: "Delete…", onSelect: remove },
      ],
    }),
  );
  const trigger = screen.getByRole("button", { name: "Actions for /media" });
  return { enable, remove, trigger };
}

it("opens on the first enabled command and closes after running one", () => {
  const { enable, trigger } = renderMenu();
  expect(screen.queryByRole("menu")).toBeNull();

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Enable" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));

  expect(enable).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("moves among enabled commands with the arrow keys, skipping a disabled one", () => {
  const { trigger } = renderMenu();
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu");

  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("Delete…");
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("Enable");
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(document.activeElement?.textContent).toBe("Delete…");
});

it("closes on Escape with focus back on the trigger, and on a press outside", () => {
  const { remove, trigger } = renderMenu();
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WindowDialog, WindowDialogFrame } from "./window-dialog.js";

afterEach(cleanup);

// A program page with one opener, rendered inside a window frame.
function Program({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => setOpen(true) }, "Open"),
    open &&
      createElement(WindowDialog, {
        title: "New thing",
        busy,
        onClose: () => setOpen(false),
        children: createElement("input", { "aria-label": "Thing name" }),
      }),
  );
}

function renderFramed(busy?: boolean) {
  const view = render(
    createElement(WindowDialogFrame, null, createElement(Program, { busy })),
  );
  const content = view.container.querySelector(".window-content")!;
  const layer = view.container.querySelector(".window-dialog-layer")!;
  return { content, layer };
}

it("renders into the window's fixed layer and makes only the content inert", () => {
  const { content, layer } = renderFramed();
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);

  const dialog = screen.getByRole("dialog", { name: "New thing" });
  expect(layer.contains(dialog)).toBe(true);
  expect(content.contains(dialog)).toBe(false);
  expect(content.hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText("Thing name"));

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(content.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(opener);
});

it("stays open while busy", () => {
  renderFramed(true);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const dialog = screen.getByRole("dialog", { name: "New thing" });

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(
    screen
      .getByRole("button", { name: "Close New thing" })
      .matches(":disabled"),
  ).toBe(true);
  expect(screen.getByRole("dialog", { name: "New thing" })).toBe(dialog);
});

it("focuses the panel, not a button, when the dialog has no field", () => {
  render(
    createElement(WindowDialog, {
      title: "Delete thing",
      onClose: () => undefined,
      children: createElement("button", null, "Delete thing permanently"),
    }),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("dialog", { name: "Delete thing" }),
  );
});

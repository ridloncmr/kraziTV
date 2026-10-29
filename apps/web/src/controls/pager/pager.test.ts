// @vitest-environment jsdom
import { createElement, useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Pager } from "./pager.js";

afterEach(cleanup);

// A window that scrolls, holding a pager (optionally in a sticky header) above a list.
function Page({ sticky }: { sticky: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const pager = createElement(Pager, {
    offset: 0,
    limit: 10,
    total: 30,
    list,
    onChange: () => {},
  });
  return createElement(
    "div",
    { "data-testid": "scroller", style: { overflowY: "auto" } },
    sticky
      ? createElement("div", { style: { position: "sticky" } }, pager)
      : pager,
    createElement("div", { ref: list, "data-testid": "list" }),
  );
}

// jsdom has no layout, so each element reports the top edge it is given.
function placeTops(edges: { scroller: number; list: number; sticky?: number }) {
  const scroller = screen.getByTestId("scroller");
  const list = screen.getByTestId("list");
  const rect = (top: number, bottom = top) => ({ top, bottom }) as DOMRect;
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    rect(edges.scroller),
  );
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue(rect(edges.list));
  if (edges.sticky !== undefined) {
    const header = scroller.firstElementChild as HTMLElement;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
      rect(0, edges.sticky),
    );
  }
  return { scroller, list };
}

it("scrolls the window up to the list's first row when a page turns", () => {
  render(createElement(Page, { sticky: false }));
  const { scroller } = placeTops({ scroller: 100, list: -400 });
  scroller.scrollTop = 900;
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(scroller.scrollTop).toBe(400);
});

it("stops the list's first row just below a sticky header", () => {
  render(createElement(Page, { sticky: true }));
  const { scroller } = placeTops({ scroller: 0, list: -300, sticky: 80 });
  scroller.scrollTop = 1000;
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(scroller.scrollTop).toBe(620);
});

it("leaves the window alone when the list's top is already in view", () => {
  render(createElement(Page, { sticky: false }));
  const { scroller } = placeTops({ scroller: 0, list: 50 });
  scroller.scrollTop = 20;
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(scroller.scrollTop).toBe(20);
});

it("scrolls a list that scrolls by itself back to its top", () => {
  render(createElement(Page, { sticky: false }));
  const { list } = placeTops({ scroller: 0, list: 0 });
  list.scrollTop = 250;
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(list.scrollTop).toBe(0);
});

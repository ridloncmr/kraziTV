// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { fakeShell } from "../testing/fake-shell.js";
import { ProgramContents } from "./program-contents.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** Serves an empty catalog with no channels and no TMDB key, so each program offers its next step. */
function serveEmptyNetwork() {
  const api = new BrowserApi();
  api.reply("/channels", []);
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/metadata/tmdb-key", { configured: false });
  vi.stubGlobal("fetch", api.fetch);
}

it.each([
  // The guide is handed the shell's `openProgram` itself.
  { from: "guide", next: "Open My Channels", opens: "channels", task: [] },
  // TV is handed the host's own My Channels callback instead.
  { from: "tv", next: "Open My Channels", opens: "channels", task: [] },
  // Media Library opens Account Settings on a task.
  {
    from: "media",
    next: "Set up TMDB…",
    opens: "account",
    task: ["set-up-tmdb"],
  },
] as const)(
  "opens $opens in front from $from's $next",
  async ({ from, next, opens, task }) => {
    serveEmptyNetwork();
    const shell = fakeShell(from);
    render(<ProgramContents id={from} visible {...shell.hostProps} />);

    fireEvent.click(await screen.findByRole("button", { name: next }));

    expect(shell.hostProps.openProgram).toHaveBeenCalledExactlyOnceWith(
      opens,
      ...task,
    );
    expect(shell.windowIds()).toEqual([from, opens]);
  },
);

it("brings an open program forward instead of opening it twice", async () => {
  serveEmptyNetwork();
  const shell = fakeShell("channels", "guide");
  render(<ProgramContents id="guide" visible {...shell.hostProps} />);
  const next = await screen.findByRole("button", { name: "Open My Channels" });

  fireEvent.click(next);
  expect(shell.windowIds()).toEqual(["guide", "channels"]);
  fireEvent.click(next);
  expect(shell.windowIds()).toEqual(["guide", "channels"]);
  expect(shell.hostProps.openProgram).toHaveBeenCalledTimes(2);
});

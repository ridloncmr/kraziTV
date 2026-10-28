import { describe, expect, it } from "vitest";
import type { DesktopWindow } from "../contracts.js";
import { rememberWindows, type WindowMemory } from "./window-memory.js";
import { windowReducer } from "./window-state.js";

describe("desktop windows", () => {
  it("opens a program where this browser last left it, else cascaded", () => {
    const remembered = {
      channels: { x: 10, y: 20, width: 500, height: 400, maximized: true },
    };
    let state = windowReducer([], { type: "open", id: "channels" }, remembered);
    state = windowReducer(state, { type: "open", id: "media" }, remembered);
    expect(state[0]).toMatchObject(remembered.channels);
    expect(state[1]).toMatchObject({ x: 164, y: 64, width: 760, height: 540 });
  });

  it("opens each channel's properties window a step past those already open, from their shared placement", () => {
    const remembered = {
      "channel-properties": {
        x: 300,
        y: 100,
        width: 500,
        height: 400,
        maximized: false,
      },
    };
    let state = windowReducer([], { type: "open", id: "channels" }, remembered);
    for (const id of ["one", "two"] as const)
      state = windowReducer(
        state,
        { type: "open", id: `channel-properties:${id}` },
        remembered,
      );
    expect(state.slice(1)).toMatchObject([
      { id: "channel-properties:one", x: 300, y: 100, width: 500 },
      { id: "channel-properties:two", x: 324, y: 124, width: 500 },
    ]);
    // Opening one again brings it forward instead of adding another.
    state = windowReducer(state, {
      type: "open",
      id: "channel-properties:one",
    });
    expect(state.map((item) => item.id)).toEqual([
      "channels",
      "channel-properties:two",
      "channel-properties:one",
    ]);
  });

  it("keeps a steady cascade while memory follows the front properties window, as the shell does", () => {
    let memory: WindowMemory = {
      "collection-properties": {
        x: 300,
        y: 100,
        width: 500,
        height: 400,
        maximized: false,
      },
    };
    let state: DesktopWindow[] = [];
    const open = (id: `collection-properties:${string}`) => {
      state = windowReducer(state, { type: "open", id }, memory);
      memory = rememberWindows(memory, state);
    };
    for (const id of ["a", "b", "c", "d"] as const)
      open(`collection-properties:${id}`);
    expect(state.map(({ x }) => x)).toEqual([300, 324, 348, 372]);
    // A new window never lands on top of one still open.
    state = windowReducer(state, {
      type: "close",
      id: "collection-properties:a",
    });
    memory = rememberWindows(memory, state);
    open("collection-properties:e");
    expect(state.at(-1)).toMatchObject({ x: 396, y: 196 });
  });

  it("reopens a minimized singleton without losing its position", () => {
    let state = windowReducer([], { type: "open", id: "channels" });
    state = windowReducer(state, {
      type: "move",
      id: "channels",
      x: 200,
      y: 90,
    });
    state = windowReducer(state, { type: "minimize", id: "channels" });
    state = windowReducer(state, { type: "open", id: "channels" });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ x: 200, y: 90, minimized: false });
  });

  it("orders focus, promotes the next visible window, and removes closed taskbar entries", () => {
    let state = windowReducer([], { type: "open", id: "channels" });
    state = windowReducer(state, { type: "open", id: "media" });
    state = windowReducer(state, { type: "focus", id: "channels" });
    expect(state.at(-1)?.id).toBe("channels");
    state = windowReducer(state, { type: "minimize", id: "channels" });
    expect(state.filter((item) => !item.minimized).at(-1)?.id).toBe("media");
    state = windowReducer(state, { type: "close", id: "media" });
    expect(state.map((item) => item.id)).toEqual(["channels"]);
  });

  it("keeps the same state when focusing the visible top window, so the desktop need not re-render", () => {
    let state = windowReducer([], { type: "open", id: "channels" });
    state = windowReducer(state, { type: "open", id: "media" });
    expect(windowReducer(state, { type: "focus", id: "media" })).toBe(state);
    expect(windowReducer(state, { type: "open", id: "media" })).toBe(state);
    expect(
      windowReducer(state, { type: "focus", id: "channels" }).at(-1)?.id,
    ).toBe("channels");
    const minimized = windowReducer(state, { type: "minimize", id: "media" });
    const restored = windowReducer(minimized, { type: "focus", id: "media" });
    expect(restored).not.toBe(minimized);
    expect(restored.at(-1)).toMatchObject({ id: "media", minimized: false });
  });

  it("preserves the normal rectangle across maximize and restore", () => {
    let state = windowReducer([], { type: "open", id: "guide" });
    state = windowReducer(state, { type: "move", id: "guide", x: 100, y: 150 });
    state = windowReducer(state, { type: "maximize", id: "guide" });
    expect(state[0].maximized).toBe(true);
    state = windowReducer(state, { type: "maximize", id: "guide" });
    expect(state[0]).toMatchObject({ maximized: false, x: 100, y: 150 });
  });

  it("keeps a resized window's size through maximize, ignoring resizes while maximized", () => {
    let state = windowReducer([], { type: "open", id: "media" });
    expect(state[0]).toMatchObject({ width: 760, height: 540 });
    state = windowReducer(state, {
      type: "resize",
      id: "media",
      width: 900,
      height: 600,
    });
    state = windowReducer(state, { type: "maximize", id: "media" });
    state = windowReducer(state, {
      type: "resize",
      id: "media",
      width: 400,
      height: 300,
    });
    state = windowReducer(state, { type: "maximize", id: "media" });
    expect(state[0]).toMatchObject({ width: 900, height: 600 });
  });
});

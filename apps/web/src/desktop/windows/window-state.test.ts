import { describe, expect, it } from "vitest";
import { windowReducer } from "./window-state.js";

describe("desktop windows", () => {
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

  it("preserves the normal rectangle across maximize and restore", () => {
    let state = windowReducer([], { type: "open", id: "guide" });
    state = windowReducer(state, { type: "move", id: "guide", x: 100, y: 150 });
    state = windowReducer(state, { type: "maximize", id: "guide" });
    expect(state[0].maximized).toBe(true);
    state = windowReducer(state, { type: "maximize", id: "guide" });
    expect(state[0]).toMatchObject({ maximized: false, x: 100, y: 150 });
  });

  it("recovers windows when the usable viewport shrinks", () => {
    let state = windowReducer([], { type: "open", id: "guide" });
    state = windowReducer(state, { type: "move", id: "guide", x: 900, y: 600 });
    state = windowReducer(state, { type: "viewport", width: 360, height: 480 });
    expect(state[0].x).toBe(0);
    expect(state[0].y).toBe(0);
  });
});

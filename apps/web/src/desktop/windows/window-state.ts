import type { DesktopWindow, WindowAction } from "../contracts.js";

/** Array order is stacking order, keeping taskbar membership and focus in one state. */
export function windowReducer(
  state: DesktopWindow[],
  action: WindowAction,
): DesktopWindow[] {
  if (action.type === "viewport") {
    return state.map((item) => ({
      ...item,
      x: Math.max(0, Math.min(item.x, action.width - 760)),
      y: Math.max(0, Math.min(item.y, action.height - 540)),
    }));
  }
  if (action.type === "close")
    return state.filter((item) => item.id !== action.id);
  const existing = state.find((item) => item.id === action.id);
  if (action.type === "open" || action.type === "focus") {
    if (!existing && action.type === "focus") return state;
    const offset = 24 * state.length;
    const item = existing ?? {
      id: action.id,
      openedOrder: Math.max(-1, ...state.map((entry) => entry.openedOrder)) + 1,
      x: 140 + offset,
      y: 40 + offset,
      minimized: false,
      maximized: false,
    };
    return [
      ...state.filter((entry) => entry.id !== action.id),
      { ...item, minimized: false },
    ];
  }
  return state.map((item) => {
    if (item.id !== action.id) return item;
    switch (action.type) {
      case "minimize":
        return { ...item, minimized: true };
      case "maximize":
        return { ...item, maximized: !item.maximized };
      case "move":
        return item.maximized ? item : { ...item, x: action.x, y: action.y };
    }
    return item;
  });
}

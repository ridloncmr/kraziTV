import { createElement, useCallback, useState, type ReactElement } from "react";
import type { WindowAction, WindowId } from "../desktop/contracts.js";
import { CloseWindow } from "../desktop/windows/close-window.js";
import { usePropertiesWindows } from "../desktop/windows/use-properties-windows.js";

/**
 * The shell's properties-window bookkeeping over a plain list of open
 * window IDs, so a test can open and close properties windows without
 * the desktop. Only `open` and `close` matter here; other actions do not
 * change which windows are open.
 */
export function usePropertiesTestWindows() {
  const [open, setOpen] = useState<readonly WindowId[]>([]);
  const dispatch = useCallback((action: WindowAction) => {
    if (action.type === "open")
      setOpen((ids) => (ids.includes(action.id) ? ids : [...ids, action.id]));
    if (action.type === "close")
      setOpen((ids) => ids.filter((id) => id !== action.id));
  }, []);
  return { open, dispatch, ...usePropertiesWindows(dispatch) };
}

/**
 * One properties window as the shell frames it: a region named for its
 * title, whose content gets a stable unsaved callback bound to the window,
 * since an unstable one would re-run the content's dirty effect forever,
 * and the window's close, which closes at once as the shell's does.
 */
export function PropertiesTestWindow({
  id,
  windows,
  render,
}: {
  id: WindowId;
  windows: ReturnType<typeof usePropertiesTestWindows>;
  render: (onDirtyChange: (dirty: boolean) => void) => ReactElement;
}) {
  const { markUnsaved, dispatch } = windows;
  const onDirtyChange = useCallback(
    (dirty: boolean) => markUnsaved(id, dirty),
    [id, markUnsaved],
  );
  const close = useCallback(
    () => dispatch({ type: "close", id }),
    [dispatch, id],
  );
  return createElement(
    "section",
    { "aria-label": windows.titleOf(id) },
    createElement(
      CloseWindow.Provider,
      { value: close },
      render(onDirtyChange),
    ),
  );
}

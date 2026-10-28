import { useCallback, useState } from "react";
import type { WindowAction, WindowId } from "../desktop/contracts.js";
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
  return { open, ...usePropertiesWindows(dispatch) };
}

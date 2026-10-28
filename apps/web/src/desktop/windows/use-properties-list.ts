import { useCallback, useEffect, useRef } from "react";
import type {
  PropertiesObject,
  PropertiesWindows,
} from "./use-properties-windows.js";

/**
 * How a program listing one properties kind follows that kind's windows. It
 * reads its list again whenever a window saves a change; the first render
 * already reads it. And it opens what a creation dialog created only once
 * that dialog has closed, since the dialog returning focus to the list would
 * otherwise bring it back over the window just opened. Returns the callback
 * a creation dialog's success hands its object to.
 */
export function usePropertiesList(
  windows: PropertiesWindows,
  refresh: () => void,
  dialogOpen: boolean,
) {
  const seenRevision = useRef(windows.revision);
  useEffect(() => {
    if (seenRevision.current === windows.revision) return;
    seenRevision.current = windows.revision;
    refresh();
  }, [windows.revision, refresh]);
  const created = useRef<PropertiesObject>(undefined);
  useEffect(() => {
    if (dialogOpen || !created.current) return;
    windows.show(created.current);
    created.current = undefined;
  }, [dialogOpen, windows]);
  return useCallback((object: PropertiesObject) => {
    created.current = object;
  }, []);
}

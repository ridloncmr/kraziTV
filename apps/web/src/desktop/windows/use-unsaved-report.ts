import { useEffect } from "react";

/**
 * Tells the window whether this editor holds unsaved edits, so closing the
 * window asks first, and that it holds none once the editor closes. One
 * editor reports per window at a time: the others sit behind tabs or a
 * window dialog.
 */
export function useUnsavedReport(
  dirty: boolean,
  onDirtyChange: (dirty: boolean) => void,
): void {
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
}

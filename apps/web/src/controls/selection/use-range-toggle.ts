import { useState, type ChangeEvent } from "react";
import { rowClickProps } from "./row-click.js";

/**
 * Lists the IDs from the anchor through the target in display order. An
 * anchor no longer displayed, such as one on another catalog page, falls
 * back to the target alone so a range never reaches rows the viewer cannot see.
 */
function rangeOf(
  order: readonly string[],
  anchor: string | undefined,
  target: string,
) {
  const from = anchor === undefined ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from < 0 || to < 0) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * Toggles checkbox-grid rows, with Shift extending from the last clicked row
 * as mail clients do: every row in the range takes the clicked row's new
 * state. Rows and their checkboxes share it, so Shift works on either.
 */
export function useRangeToggle(
  order: readonly string[],
  isOn: (id: string) => boolean,
  set: (ids: string[], on: boolean) => void,
) {
  const [anchor, setAnchor] = useState<string>();

  /** Applies one click; every click, ranged or not, becomes the next anchor. */
  function toggle(id: string, extend: boolean) {
    set(extend ? rangeOf(order, anchor, id) : [id], !isOn(id));
    setAnchor(id);
  }

  return {
    /** Props that make a whole row toggle its item. */
    row: (id: string) => rowClickProps((extend) => toggle(id, extend)),
    /**
     * A checkbox change handler. React fires checkbox changes from the click
     * event, so the native event carries the Shift state.
     */
    checkbox: (id: string) => (event: ChangeEvent<HTMLInputElement>) =>
      toggle(id, (event.nativeEvent as MouseEvent).shiftKey === true),
  };
}

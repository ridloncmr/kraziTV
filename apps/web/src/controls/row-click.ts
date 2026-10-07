import type { MouseEvent } from "react";

const ROW_CONTROLS = "button, input, select, textarea, a, label";

/**
 * Makes a click anywhere on a table row run its primary action, as list views
 * do, and reports whether Shift was held so a grid can extend a range. Clicks
 * on the row's own controls, and drags that select text such as a path to
 * copy, keep their usual meaning. The row's control stays the keyboard and
 * screen-reader path; this is a pointer convenience only.
 */
export function rowClickProps(action: (extend: boolean) => void) {
  return {
    /** Keeps Shift from extending text selection, since it extends rows instead. */
    onMouseDown(event: MouseEvent<HTMLElement>) {
      if (event.shiftKey) event.preventDefault();
    },
    /** Runs the action unless the click belonged to a control or a text drag. */
    onClick(event: MouseEvent<HTMLElement>) {
      if ((event.target as HTMLElement).closest(ROW_CONTROLS)) return;
      if (!event.shiftKey && window.getSelection()?.toString()) return;
      action(event.shiftKey);
    },
  };
}

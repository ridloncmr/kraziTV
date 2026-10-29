import { useRef, type RefObject } from "react";
import { displayCount } from "../formatting/display-count.js";

/**
 * Moves through a server-paged list; the server's total, not the loaded rows, sets the bounds. Its buttons never submit a form it sits in.
 * Turning a page brings `list` back to its first row, so the owner never has to scroll up to start reading the new page.
 */
export function Pager({
  offset,
  limit,
  total,
  list,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  list: RefObject<HTMLElement | null>;
  onChange: (offset: number) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  // A shrunken catalog can leave the offset past the end, so Previous stays reachable.
  if (offset === 0 && total <= limit) return null;
  const first = Math.min(offset + 1, total);
  const last = Math.min(offset + limit, total);
  const turnTo = (next: number) => {
    if (list.current && nav.current)
      scrollToListStart(list.current, nav.current);
    onChange(next);
  };
  return (
    <nav ref={nav} className="pager" aria-label="Pages">
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => turnTo(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span>
        {displayCount(first)}–{displayCount(last)} of {displayCount(total)}
      </span>
      <button
        type="button"
        disabled={offset + limit >= total}
        onClick={() => turnTo(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}

/**
 * Shows the list's first row: scrolls the list itself to its top, then scrolls
 * the window or dialog holding it up just far enough that the list's top edge
 * clears a sticky header the pager sits in. It never scrolls down, so a list
 * already showing its top stays put.
 */
function scrollToListStart(list: HTMLElement, pager: HTMLElement) {
  list.scrollTop = 0;
  const scroller = scrollingAncestor(list);
  if (!scroller) return;
  const sticky = stickyAncestor(pager, scroller);
  const visibleTop = sticky
    ? sticky.getBoundingClientRect().bottom
    : scroller.getBoundingClientRect().top;
  const hidden = visibleTop - list.getBoundingClientRect().top;
  if (hidden > 0) scroller.scrollTop -= hidden;
}

/** The nearest ancestor that scrolls vertically: a window's content or a dialog's body. */
function scrollingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** The sticky header holding the pager, if any, below `scroller`. */
function stickyAncestor(
  element: HTMLElement,
  scroller: HTMLElement,
): HTMLElement | null {
  for (
    let node: HTMLElement | null = element;
    node && node !== scroller;
    node = node.parentElement
  ) {
    if (getComputedStyle(node).position === "sticky") return node;
  }
  return null;
}

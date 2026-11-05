import type { KeyboardEvent } from "react";

/**
 * Moves focus among the buttons of `columns` with the arrow keys, as XP's
 * Start menu and desktop did: Up and Down wrap within the focused column,
 * Home and End jump to its first and last entries, and Left and Right keep
 * the row in the next column, or its last entry when that column is
 * shorter. Focus outside every column, and every other key, keep their
 * meaning. Start passes its two columns; the desktop is one.
 */
export function navigateWithArrows(
  event: KeyboardEvent<HTMLElement>,
  columns: readonly Element[],
) {
  const focused = document.activeElement;
  const column = columns.find((group) => group.contains(focused));
  if (!column) return;
  const buttons = (group: Element) => [
    ...group.querySelectorAll<HTMLButtonElement>("button"),
  ];
  const entries = buttons(column);
  const at = entries.indexOf(focused as HTMLButtonElement);
  if (at === -1) return;
  const across = (step: number) => {
    const next = columns[columns.indexOf(column) + step];
    if (!next) return entries[at];
    const neighbours = buttons(next);
    return neighbours[Math.min(at, neighbours.length - 1)];
  };
  const next = {
    ArrowDown: () => entries[(at + 1) % entries.length],
    ArrowUp: () => entries[(at - 1 + entries.length) % entries.length],
    Home: () => entries[0],
    End: () => entries.at(-1),
    ArrowRight: () => across(1),
    ArrowLeft: () => across(-1),
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  next()?.focus();
}

import type { KeyboardEvent } from "react";

/**
 * Cancels Enter in a search box. Every search box searches as the owner
 * types, so Enter has nothing left to do there; without this, Enter would
 * press the default button of the form around it and save, add, or turn a
 * dialog's page. Other fields keep Enter, so it still presses that button.
 */
export function holdEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.preventDefault();
}

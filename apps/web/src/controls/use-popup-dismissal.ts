import { useEffect, type RefObject } from "react";

/**
 * Closes an open popup the way XP menus close: a pointer press outside
 * `area` dismisses it without stealing the pressed target's focus, and
 * Escape dismisses it and returns keyboard users to `trigger`.
 */
export function usePopupDismissal(
  open: boolean,
  area: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    /** A press anywhere outside the popup and its trigger closes it. */
    const outside = (event: PointerEvent) => {
      if (!area.current?.contains(event.target as Node)) close();
    };
    /** Escape closes it and puts focus back where the popup opened from. */
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, area, trigger, close]);
}

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { usePopupDismissal } from "./use-popup-dismissal.js";

/** One command a row menu offers. */
interface RowMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** Where the open menu sits in the viewport, beside its trigger. */
interface MenuPlacement {
  top: number;
  right: number;
}

/**
 * A grid row's **…** button that opens an XP-style context menu of the row's
 * commands, so a row spends one narrow cell on actions. The menu is fixed to
 * the viewport because a scrolling table would clip it, so scrolling or
 * resizing closes it rather than leaving it detached from its row. Arrow
 * keys move between enabled commands, as in XP menus.
 */
export function RowMenu({
  label,
  items,
}: {
  /** The trigger's accessible name, naming the row, such as `Actions for /media`. */
  label: string;
  items: readonly RowMenuItem[];
}) {
  const [placement, setPlacement] = useState<MenuPlacement>();
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = placement !== undefined;
  const close = useCallback(() => setPlacement(undefined), []);
  usePopupDismissal(open, area, trigger, close);
  useLayoutEffect(() => {
    if (!open) return;
    // Flips above the trigger when the menu would run past the viewport.
    const box = menu.current?.getBoundingClientRect();
    const anchor = trigger.current?.getBoundingClientRect();
    if (box && anchor && box.bottom > window.innerHeight) {
      setPlacement(
        (current) =>
          current && { ...current, top: Math.max(0, anchor.top - box.height) },
      );
    }
    // Focusing must not scroll, or the scroll would close the menu at once.
    menu.current
      ?.querySelector<HTMLButtonElement>("button:enabled")
      ?.focus({ preventScroll: true });
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);
  /** Opens the menu under the trigger's right edge, or closes it when open. */
  function toggle() {
    if (open) return close();
    const anchor = trigger.current?.getBoundingClientRect();
    if (!anchor) return;
    setPlacement({
      top: anchor.bottom,
      right: window.innerWidth - anchor.right,
    });
  }
  /** Runs a command after closing, so a dialog it opens takes focus last. */
  function select(item: RowMenuItem) {
    close();
    item.onSelect();
  }
  /** Moves focus among enabled commands with the arrow, Home, and End keys. */
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ??
        []),
    ];
    if (enabled.length === 0) return;
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = {
      ArrowDown: (at + 1) % enabled.length,
      ArrowUp: (at - 1 + enabled.length) % enabled.length,
      Home: 0,
      End: enabled.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    enabled[next].focus();
  }
  return (
    <div ref={area} className="row-menu">
      <button
        ref={trigger}
        className="row-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        …
      </button>
      {placement && (
        <div
          ref={menu}
          className="row-menu-list"
          role="menu"
          aria-label={label}
          style={placement}
          onKeyDown={navigate}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => select(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Whether an event came from a row menu, whose clicks and keys keep their own meaning inside a row. */
export function inRowMenu(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".row-menu") !== null;
}

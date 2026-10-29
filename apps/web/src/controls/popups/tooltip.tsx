import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/** How long a pointer rests on a control before its tip shows, so passing over a row of them shows nothing. */
const SHOW_DELAY_MS = 500;
/** Within this long of a tip closing, the next one opens at once, so reading along a row feels instant. */
const INSTANT_WITHIN_MS = 500;

// When the last tip closed, across every tooltip on the page.
let lastClosedAt = Number.NEGATIVE_INFINITY;

/** Where the tip sits relative to its control; `taskbar` rises over a scrolling strip that would clip it. */
type TooltipPlacement = "below" | "above" | "above-end" | "taskbar";

/**
 * An XP tool tip for a shell control: a small yellow note that appears after
 * the pointer rests on the control, at once when another tip just closed,
 * and at once on keyboard focus. A touch never shows one, since there is
 * nothing to rest. When the note says more than the control's own name, the
 * caller gives the control `aria-describedby={id}`, so the note describes it
 * whether or not it is showing.
 */
export function Tooltip({
  id,
  text,
  placement = "below",
  children,
}: {
  id: string;
  text: string;
  placement?: TooltipPlacement;
  children: ReactNode;
}) {
  const [shown, setShown] = useState<"no" | "eased" | "instant">("no");
  // Mirrors `shown` for the leave handler, which must record the closing
  // time before the neighbour's enter handler runs, not when React renders.
  const showing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  /** Shows the tip now, at once or faded in. */
  const show = (how: "eased" | "instant") => {
    showing.current = true;
    setShown(how);
  };
  /** Shows the tip, at once when one just closed, else after the pointer has rested. */
  const rest = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (Date.now() - lastClosedAt <= INSTANT_WITHIN_MS) {
      show("instant");
      return;
    }
    timer.current = setTimeout(() => show("eased"), SHOW_DELAY_MS);
  };
  /** Hides the tip and remembers when, so a neighbour's can open at once. */
  const leave = () => {
    clearTimeout(timer.current);
    if (showing.current) lastClosedAt = Date.now();
    showing.current = false;
    setShown("no");
  };
  /** Keyboard focus shows the tip at once; a click's focus does not, since the pointer already rests there. */
  const focus = (event: FocusEvent) => {
    if (event.target.matches(":focus-visible")) show("eased");
  };
  return (
    <span
      className="tooltip-host"
      onPointerEnter={rest}
      onPointerLeave={leave}
      onPointerDown={leave}
      onFocus={focus}
      onBlur={leave}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={`tooltip tooltip-${placement}`}
        data-shown={shown !== "no"}
        data-instant={shown === "instant"}
      >
        {text}
      </span>
    </span>
  );
}

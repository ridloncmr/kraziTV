import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** What a window lends its program's dialogs: the layer they render into and a hold that makes the content inert. */
interface DialogLayer {
  element: HTMLElement | null;
  hold: () => () => void;
}

/** Absent outside a window frame, where dialogs render in place. */
const WindowDialogLayer = createContext<DialogLayer | null>(null);

/**
 * A hold that keeps `target` inert while any holder remains. It writes the
 * attribute directly so a closing dialog can return focus to its opener in
 * the same commit, before React would re-render.
 */
function inertHold(
  target: RefObject<HTMLElement | null>,
  holds: { current: number },
): DialogLayer["hold"] {
  return () => {
    target.current?.toggleAttribute("inert", ++holds.current > 0);
    return () => target.current?.toggleAttribute("inert", --holds.current > 0);
  };
}

/**
 * Wraps a window's scrolling content with a fixed layer for its dialogs, so a
 * dialog neither scrolls with the content nor leaves the window. While any
 * dialog is open the content is inert; the title bar stays usable.
 */
export function WindowDialogFrame({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const holds = useRef(0);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const layer = useMemo<DialogLayer>(
    () => ({ element, hold: inertHold(content, holds) }),
    [element],
  );
  return (
    <div className="window-body">
      <div ref={content} className="window-content">
        <WindowDialogLayer.Provider value={layer}>
          {children}
        </WindowDialogLayer.Provider>
      </div>
      <div ref={setElement} className="window-dialog-layer" />
    </div>
  );
}

/**
 * A dialog owned by the program window it opens in. It covers only that
 * window's content, leaving other windows and the taskbar usable, so it is
 * not marked aria-modal. Escape closes it, and focus returns to its opener.
 * A busy dialog cannot close, because unmounting would abandon a request the
 * server may still commit. A dialog opened from inside another stacks over
 * it in the same layer and makes it inert until it closes.
 */
export function WindowDialog({
  title,
  busy = false,
  onClose,
  children,
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const layer = useContext(WindowDialogLayer);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const holds = useRef(0);
  // Dialogs opened from this one share its window's layer but hold this panel.
  const nested = useMemo<DialogLayer | null>(
    () => layer && { element: layer.element, hold: inertHold(panel, holds) },
    [layer],
  );
  // Declared before the focus effect so its release runs first on close and
  // the opener is focusable again when focus returns to it.
  useEffect(() => layer?.hold(), [layer]);
  useEffect(() => {
    const opener = document.activeElement;
    // Only a field takes initial focus; a confirmation focuses the panel so a
    // stray Enter never presses its destructive button.
    const first = panel.current?.querySelector<HTMLElement>(
      ".window-dialog-body :is(input, select, textarea):not(:disabled)",
    );
    (first ?? panel.current)?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  const dialog = (
    <div
      ref={panel}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="window-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div className="window-dialog-title">
        <span id={titleId}>{title}</span>
        <button
          type="button"
          aria-label={`Close ${title}`}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {/* Program control styles are scoped to program pages, and the layer sits outside the page. */}
      <div className="window-dialog-body program-page">
        <WindowDialogLayer.Provider value={nested}>
          {children}
        </WindowDialogLayer.Provider>
      </div>
    </div>
  );
  if (!layer) return dialog;
  return layer.element && createPortal(dialog, layer.element);
}

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type ReactNode,
} from "react";
import { DesktopProgramIcon } from "../../branding/icons/desktop-program-icon.js";
import {
  WindowDialog,
  WindowDialogFrame,
} from "../../controls/window-dialog.js";
import { WindowStatusSlot } from "../../controls/window-status.js";
import type {
  DesktopViewport,
  DesktopWindow,
  ProgramDefinition,
  WindowAction,
} from "../contracts.js";

/** Smallest window that still shows its title controls and a usable slice of content. */
const minimumSize = { width: 360, height: 240 };

/** How long a minimized window stays shown while it shrinks; `--xp-duration-popup` in xp-tokens.css draws it. */
const MINIMIZE_MS = 150;

/** Shrinks a window to the usable viewport, then shifts it until it sits fully inside. */
function withinViewport(
  rect: { x: number; y: number; width: number; height: number },
  viewport: DesktopViewport,
) {
  const width = Math.min(
    Math.max(rect.width, minimumSize.width),
    viewport.width,
  );
  const height = Math.min(
    Math.max(rect.height, minimumSize.height),
    viewport.height,
  );
  return {
    x: Math.max(0, Math.min(rect.x, viewport.width - width)),
    y: Math.max(0, Math.min(rect.y, viewport.height - height)),
    width,
    height,
  };
}

/** Hosts arbitrary program contents while owning only chrome and pointer/keyboard movement and sizing. */
export function AppWindow({
  window,
  program,
  title,
  unsavedName,
  avatarId,
  active,
  index,
  viewport,
  dispatch,
  children,
}: {
  window: DesktopWindow;
  program: ProgramDefinition;
  /** The title bar's and region's name, which may name what the window shows. */
  title: string;
  /** What holds unsaved changes in this window, if anything; closing it then asks first. */
  unsavedName?: string;
  /** The account's picture, which Account Settings' title bar draws. */
  avatarId: string;
  active: boolean;
  index: number;
  viewport: DesktopViewport;
  dispatch: Dispatch<WindowAction>;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Changes saved meanwhile leave nothing to discard, so the question ends.
  if (confirmingClose && unsavedName === undefined) setConfirmingClose(false);
  /** Closes the window, first asking whether to drop unsaved changes, which closing would lose silently. */
  function close() {
    if (unsavedName === undefined) dispatch({ type: "close", id: window.id });
    else setConfirmingClose(true);
  }
  const titleBar = useRef<HTMLDivElement>(null);
  // Where the program's pending requests show, once the status bar exists.
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  // A minimized window stays shown for one beat, shrinking toward its taskbar
  // button as XP's did, then hides. Adjusted during render, so the frame is
  // never hidden on the first minimized paint and can still be measured.
  const [shrinking, setShrinking] = useState(false);
  const [seenMinimized, setSeenMinimized] = useState(window.minimized);
  if (seenMinimized !== window.minimized) {
    setSeenMinimized(window.minimized);
    setShrinking(window.minimized);
  }
  // Where the shrink aims, relative to the frame: the taskbar button's centre.
  const [shrinkOrigin, setShrinkOrigin] = useState<string>();
  useLayoutEffect(() => {
    if (!window.minimized) return;
    // Measured before paint, so the first shrinking frame already aims right.
    const target = document
      .querySelector(`[data-taskbar-window="${window.id}"]`)
      ?.getBoundingClientRect();
    const own = frame.current?.getBoundingClientRect();
    if (target && own)
      setShrinkOrigin(
        `${target.left + target.width / 2 - own.left}px ${target.top - own.top}px`,
      );
    const timer = setTimeout(() => setShrinking(false), MINIMIZE_MS);
    return () => clearTimeout(timer);
  }, [window.minimized, window.id]);
  const gesture = useRef<{
    apply: (a: number, b: number) => void;
    x: number;
    y: number;
    fromA: number;
    fromB: number;
  } | null>(null);
  useEffect(() => {
    if (active && !frame.current?.contains(document.activeElement))
      titleBar.current?.focus();
  }, [active]);
  const shown = withinViewport(window, viewport);
  /** Commits a move bounded to the usable viewport so the entire title bar remains recoverable. */
  function move(x: number, y: number) {
    const placed = withinViewport({ ...shown, x, y }, viewport);
    dispatch({ type: "move", id: window.id, x: placed.x, y: placed.y });
  }
  /** Commits a size bounded to the space right of and below the window, so growing never shifts it. */
  function resize(width: number, height: number) {
    dispatch({
      type: "resize",
      id: window.id,
      width: Math.max(
        minimumSize.width,
        Math.min(width, viewport.width - shown.x),
      ),
      height: Math.max(
        minimumSize.height,
        Math.min(height, viewport.height - shown.y),
      ),
    });
  }
  /** Captures the pointer so a drag keeps tracking after it leaves the title bar or grip. */
  function startGesture(
    event: PointerEvent<HTMLElement>,
    apply: (a: number, b: number) => void,
    fromA: number,
    fromB: number,
  ) {
    gesture.current = {
      apply,
      x: event.clientX,
      y: event.clientY,
      fromA,
      fromB,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  /** Shared by the title bar and grip: applies pointer travel to whichever gesture began. */
  const tracking = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (current)
        current.apply(
          current.fromA + event.clientX - current.x,
          current.fromB + event.clientY - current.y,
        );
    },
    onPointerUp: () => {
      gesture.current = null;
    },
    onPointerCancel: () => {
      gesture.current = null;
    },
  };
  return (
    <section
      ref={frame}
      className={`app-window ${active ? "active" : "inactive"} ${window.maximized ? "maximized" : ""} ${window.minimized && shrinking ? "minimizing" : ""}`}
      role="region"
      aria-label={title}
      hidden={window.minimized && !shrinking}
      style={{
        left: shown.x,
        top: shown.y,
        width: shown.width,
        height: shown.height,
        zIndex: index + 1,
        transformOrigin: shrinkOrigin,
      }}
      onPointerDown={() => dispatch({ type: "focus", id: window.id })}
      onFocusCapture={() => {
        if (!active) dispatch({ type: "focus", id: window.id });
      }}
    >
      <div
        ref={titleBar}
        tabIndex={0}
        className="title-bar"
        aria-label={`${title} window. Arrow keys move; Shift+Arrow keys resize; double click maximizes.`}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button"))
            dispatch({ type: "maximize", id: window.id });
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const steps: Record<string, [number, number]> = {
            ArrowLeft: [-20, 0],
            ArrowRight: [20, 0],
            ArrowUp: [0, -20],
            ArrowDown: [0, 20],
          };
          const step = steps[event.key];
          if (!step) return;
          event.preventDefault();
          if (event.shiftKey)
            resize(shown.width + step[0], shown.height + step[1]);
          else move(shown.x + step[0], shown.y + step[1]);
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            window.maximized ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          startGesture(event, move, shown.x, shown.y);
        }}
        {...tracking}
      >
        <span className="window-caption">
          <DesktopProgramIcon
            program={program.id}
            avatarId={avatarId}
            size={19}
          />
          {title}
        </span>
        <span className="window-controls">
          <button
            aria-label={`Minimize ${title}`}
            onClick={() => dispatch({ type: "minimize", id: window.id })}
          >
            _
          </button>
          <button
            aria-label={`${window.maximized ? "Restore" : "Maximize"} ${title}`}
            onClick={() => dispatch({ type: "maximize", id: window.id })}
          >
            {window.maximized ? "❐" : "□"}
          </button>
          <button
            className="close-control"
            aria-label={`Close ${title}`}
            onClick={close}
          >
            ×
          </button>
        </span>
      </div>
      <WindowStatusSlot.Provider value={statusSlot}>
        <WindowDialogFrame>
          {children}
          {confirmingClose && (
            <WindowDialog
              title="Unsaved changes"
              onClose={() => setConfirmingClose(false)}
            >
              <p>
                Discard your unsaved changes to <strong>{unsavedName}</strong>?
              </p>
              <div className="dialog-actions">
                <button
                  onClick={() => dispatch({ type: "close", id: window.id })}
                >
                  Discard changes
                </button>
                <button onClick={() => setConfirmingClose(false)}>
                  Keep editing
                </button>
              </div>
            </WindowDialog>
          )}
        </WindowDialogFrame>
      </WindowStatusSlot.Provider>
      <div className="window-status">
        <span>kraziTV · {program.description}</span>
        <span ref={setStatusSlot} className="window-status-working" />
      </div>
      {!window.maximized && (
        <div
          className="resize-grip"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            startGesture(event, resize, shown.width, shown.height);
          }}
          {...tracking}
        />
      )}
    </section>
  );
}

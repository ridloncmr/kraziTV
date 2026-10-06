import {
  useEffect,
  useRef,
  type Dispatch,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ProgramIcon } from "../../branding/program-icon.js";
import type {
  DesktopViewport,
  DesktopWindow,
  ProgramDefinition,
  WindowAction,
} from "../contracts.js";

/** Smallest window that still shows its title controls and a usable slice of content. */
const minimumSize = { width: 360, height: 240 };

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
  active,
  index,
  viewport,
  dispatch,
  children,
}: {
  window: DesktopWindow;
  program: ProgramDefinition;
  active: boolean;
  index: number;
  viewport: DesktopViewport;
  dispatch: Dispatch<WindowAction>;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    apply: (a: number, b: number) => void;
    x: number;
    y: number;
    fromA: number;
    fromB: number;
  } | null>(null);
  useEffect(() => {
    if (active && !frame.current?.contains(document.activeElement))
      title.current?.focus();
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
      className={`app-window ${active ? "active" : "inactive"} ${window.maximized ? "maximized" : ""}`}
      role="region"
      aria-label={program.name}
      hidden={window.minimized}
      style={{
        left: shown.x,
        top: shown.y,
        width: shown.width,
        height: shown.height,
        zIndex: index + 1,
      }}
      onPointerDown={() => dispatch({ type: "focus", id: window.id })}
      onFocusCapture={() => {
        if (!active) dispatch({ type: "focus", id: window.id });
      }}
    >
      <div
        ref={title}
        tabIndex={0}
        className="title-bar"
        aria-label={`${program.name} window. Arrow keys move; Shift+Arrow keys resize; double click maximizes.`}
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
          <ProgramIcon program={program.id} size={19} />
          {program.name}
        </span>
        <span className="window-controls">
          <button
            aria-label={`Minimize ${program.name}`}
            onClick={() => dispatch({ type: "minimize", id: window.id })}
          >
            _
          </button>
          <button
            aria-label={`${window.maximized ? "Restore" : "Maximize"} ${program.name}`}
            onClick={() => dispatch({ type: "maximize", id: window.id })}
          >
            {window.maximized ? "❐" : "□"}
          </button>
          <button
            className="close-control"
            aria-label={`Close ${program.name}`}
            onClick={() => dispatch({ type: "close", id: window.id })}
          >
            ×
          </button>
        </span>
      </div>
      <div className="window-content">{children}</div>
      <div className="window-status">kraziTV · {program.description}</div>
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

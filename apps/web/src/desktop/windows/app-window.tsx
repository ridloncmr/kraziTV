import { useEffect, useRef, type Dispatch, type ReactNode } from "react";
import { ProgramIcon } from "../../branding/program-icon.js";
import type {
  DesktopViewport,
  DesktopWindow,
  ProgramDefinition,
  WindowAction,
} from "../contracts.js";

/** Keeps a 760x540 window (smaller when CSS shrinks it) fully inside the usable viewport. */
function withinViewport(x: number, y: number, viewport: DesktopViewport) {
  return {
    x: Math.max(0, Math.min(x, viewport.width - 760)),
    y: Math.max(0, Math.min(y, viewport.height - 540)),
  };
}

/** Hosts arbitrary program contents while owning only chrome and pointer/keyboard movement. */
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
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    if (active && !frame.current?.contains(document.activeElement))
      title.current?.focus();
  }, [active]);
  const shown = withinViewport(window.x, window.y, viewport);
  /** Commits a move bounded to the usable viewport so the entire title bar remains recoverable. */
  function move(x: number, y: number) {
    dispatch({
      type: "move",
      id: window.id,
      ...withinViewport(x, y, viewport),
    });
  }
  return (
    <section
      ref={frame}
      className={`app-window ${active ? "active" : "inactive"} ${window.maximized ? "maximized" : ""}`}
      role="region"
      aria-label={program.name}
      hidden={window.minimized}
      style={{ left: shown.x, top: shown.y, zIndex: index + 1 }}
      onPointerDown={() => dispatch({ type: "focus", id: window.id })}
      onFocusCapture={() => {
        if (!active) dispatch({ type: "focus", id: window.id });
      }}
    >
      <div
        ref={title}
        tabIndex={0}
        className="title-bar"
        aria-label={`${program.name} window. Arrow keys move; double click maximizes.`}
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
          if (step) {
            event.preventDefault();
            move(shown.x + step[0], shown.y + step[1]);
          }
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            window.maximized ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: shown.x,
            top: shown.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            move(
              drag.current.left + event.clientX - drag.current.x,
              drag.current.top + event.clientY - drag.current.y,
            );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
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
    </section>
  );
}

import { useEffect, useRef, useState, type Dispatch } from "react";
import { ProgramIcon } from "../../branding/program-icon.js";
import type { DesktopWindow, ProgramId, WindowAction } from "../contracts.js";
import { programs } from "../programs.js";
import { StartMenu } from "./start-menu.js";

/** Taskbar derives its buttons directly from window state; minimized programs remain reachable. */
export function Taskbar({
  windows,
  activeId,
  dispatch,
  connection,
}: {
  windows: DesktopWindow[];
  activeId?: ProgramId;
  dispatch: Dispatch<WindowAction>;
  connection: string;
}) {
  const [startOpen, setStartOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const startArea = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!startOpen) return;
    /** Outside interaction dismisses navigation without stealing the newly clicked target's focus. */
    const outside = (event: PointerEvent) => {
      if (!startArea.current?.contains(event.target as Node))
        setStartOpen(false);
    };
    /** Escape returns keyboard users to the Start trigger. */
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStartOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [startOpen]);
  return (
    <footer className="taskbar">
      <div ref={startArea} className="start-area">
        <button
          ref={trigger}
          className="start-button"
          aria-expanded={startOpen}
          aria-controls="start-menu"
          onClick={() => setStartOpen(!startOpen)}
        >
          <ProgramIcon program="logo" size={25} />
          <span>start</span>
        </button>
        {startOpen && (
          <StartMenu
            openProgram={(id) => {
              dispatch({ type: "open", id });
              setStartOpen(false);
            }}
          />
        )}
      </div>
      <nav className="taskbar-programs" aria-label="Open programs">
        {[...windows]
          .sort((a, b) => a.openedOrder - b.openedOrder)
          .map((window) => (
            <button
              key={window.id}
              className={activeId === window.id ? "task-active" : ""}
              aria-pressed={activeId === window.id}
              onClick={() => dispatch({ type: "focus", id: window.id })}
              title={programs.find((program) => program.id === window.id)?.name}
            >
              <ProgramIcon program={window.id} size={18} />
              <span>
                {programs.find((program) => program.id === window.id)?.name}
              </span>
            </button>
          ))}
      </nav>
      <div className="system-tray">
        <button
          className="connection-indicator"
          title={connection}
          aria-label={connection}
          onClick={() => dispatch({ type: "open", id: "monitor" })}
        >
          <span
            className={connection === "API connected" ? "online" : "offline"}
          >
            ●
          </span>
        </button>
        <time title={clock.toLocaleDateString()}>
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
    </footer>
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { DesktopProgramIcon } from "../../branding/desktop-program-icon.js";
import { ProgramIcon } from "../../branding/program-icon.js";
import type { DesktopWindow, ProgramId, WindowAction } from "../contracts.js";
import { usePopupDismissal } from "../../controls/use-popup-dismissal.js";
import { programs } from "../programs.js";
import { StartMenu } from "./start-menu.js";

/** Taskbar derives its buttons directly from window state; minimized programs remain reachable. */
export function Taskbar({
  windows,
  activeId,
  dispatch,
  connection,
  avatarId,
  logOff,
  tray,
}: {
  windows: DesktopWindow[];
  activeId?: ProgramId;
  dispatch: Dispatch<WindowAction>;
  connection: string;
  /** The account's picture, which Account Settings' button and Start entry draw. */
  avatarId: string;
  /** Opens the Log Off confirmation, which returns focus to Start when it closes. */
  logOff: () => void;
  /** Tray items the shell adds before the connection indicator, such as the TMDB reminder. */
  tray?: ReactNode;
}) {
  const [startOpen, setStartOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const startArea = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const closeStart = useCallback(() => setStartOpen(false), []);
  usePopupDismissal(startOpen, startArea, trigger, closeStart);
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
            avatarId={avatarId}
            openProgram={(id) => {
              dispatch({ type: "open", id });
              setStartOpen(false);
            }}
            logOff={() => {
              // Focus moves to Start first, so the confirmation returns it there.
              setStartOpen(false);
              trigger.current?.focus();
              logOff();
            }}
          />
        )}
      </div>
      <nav className="taskbar-programs" aria-label="Open programs">
        {[...windows]
          .sort((a, b) => a.openedOrder - b.openedOrder)
          .map((window) => {
            const name = programs.find(
              (program) => program.id === window.id,
            )?.name;
            return (
              <button
                key={window.id}
                className={activeId === window.id ? "task-active" : ""}
                aria-pressed={activeId === window.id}
                onClick={() => dispatch({ type: "focus", id: window.id })}
                title={name}
              >
                <DesktopProgramIcon
                  program={window.id}
                  avatarId={avatarId}
                  size={18}
                />
                <span>{name}</span>
              </button>
            );
          })}
      </nav>
      <div className="system-tray">
        {tray}
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

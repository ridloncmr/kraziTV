import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { DesktopProgramIcon } from "../../branding/desktop-program-icon.js";
import { ProgramIcon } from "../../branding/program-icon.js";
import type { DesktopWindow, ProgramId, WindowAction } from "../contracts.js";
import { Tooltip } from "../../controls/tooltip.js";
import { usePopupDismissal } from "../../controls/use-popup-dismissal.js";
import { StartMenu } from "./start-menu.js";

/** Taskbar derives its buttons directly from window state; minimized programs remain reachable. */
export function Taskbar({
  windows,
  activeId,
  titleOf,
  dispatch,
  connection,
  avatarId,
  logOff,
  tray,
}: {
  windows: DesktopWindow[];
  activeId?: ProgramId;
  /** Each window's title, as its title bar shows it. */
  titleOf: (id: ProgramId) => string;
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
  const dateTip = useId();
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
            const name = titleOf(window.id);
            // The tip repeats the name, for when the button has cut it short.
            return (
              <Tooltip
                key={window.id}
                id={`taskbar-tip-${window.id}`}
                text={name}
                placement="taskbar"
              >
                <button
                  className={activeId === window.id ? "task-active" : ""}
                  aria-pressed={activeId === window.id}
                  onClick={() => dispatch({ type: "focus", id: window.id })}
                  data-taskbar-window={window.id}
                >
                  <DesktopProgramIcon
                    program={window.id}
                    avatarId={avatarId}
                    size={18}
                  />
                  <span>{name}</span>
                </button>
              </Tooltip>
            );
          })}
      </nav>
      <div className="system-tray">
        {tray}
        <Tooltip id="connection-tip" text={connection} placement="above-end">
          <button
            className="connection-indicator"
            aria-label={connection}
            onClick={() => dispatch({ type: "open", id: "monitor" })}
          >
            <span
              className={connection === "API connected" ? "online" : "offline"}
            >
              ●
            </span>
          </button>
        </Tooltip>
        <Tooltip
          id={dateTip}
          text={clock.toLocaleDateString()}
          placement="above-end"
        >
          <time aria-describedby={dateTip}>
            {clock.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </Tooltip>
      </div>
    </footer>
  );
}

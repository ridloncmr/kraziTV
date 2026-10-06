import { useEffect, useReducer, useState } from "react";
import { ProgramIcon } from "../branding/program-icon.js";
import { useResource } from "../http/use-resource.js";
import { ProgramContents } from "../program-host/program-contents.js";
import { BootScreen } from "./chrome/boot-screen.js";
import { Taskbar } from "./chrome/taskbar.js";
import { programs } from "./programs.js";
import { AppWindow } from "./windows/app-window.js";
import { windowReducer } from "./windows/window-state.js";
import type { WindowAction } from "./contracts.js";

/** Composes shell presentation with real programs, leaving domain state entirely API-backed. */
export function DesktopShell() {
  const [windows, reduce] = useReducer(windowReducer, []);
  /** Opening cascades windows only within the current usable desktop bounds. */
  function dispatch(action: WindowAction) {
    reduce(action);
    if (action.type === "open")
      reduce({
        type: "viewport",
        width: globalThis.innerWidth,
        height: globalThis.innerHeight - 32,
      });
  }
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    document.visibilityState !== "hidden",
  );
  const health = useResource<{ status: string }>(
    "/health",
    pageVisible,
    10_000,
  );
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), 650);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (minimumElapsed && (health.data || health.error)) setBooted(true);
  }, [minimumElapsed, health.data, health.error]);
  useEffect(() => {
    /** Viewport recovery uses actual available space rather than persisting a desktop layout. */
    const resize = () =>
      reduce({
        type: "viewport",
        width: globalThis.innerWidth,
        height: globalThis.innerHeight - 32,
      });
    /** Background tabs suspend operational requests without inventing a connection result. */
    const visibility = () =>
      setPageVisible(document.visibilityState !== "hidden");
    globalThis.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      globalThis.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const connection = health.error
    ? "API connection failed"
    : health.data?.status === "ok"
      ? "API connected"
      : "Checking API connection";
  const activeId = windows.filter((window) => !window.minimized).at(-1)?.id;
  if (!booted) return <BootScreen />;
  return (
    <main className="desktop-shell">
      <div className="desktop-shortcuts" aria-label="Desktop programs">
        {programs.map((program) => (
          <button
            key={program.id}
            className="desktop-shortcut"
            title={program.description}
            onClick={() => dispatch({ type: "open", id: program.id })}
          >
            <ProgramIcon program={program.id} size={54} />
            <span>{program.name}</span>
          </button>
        ))}
      </div>
      <div className="desktop-brand" aria-hidden="true">
        <strong>
          krazi<span>TV</span>
        </strong>
        <span>Your television network.</span>
      </div>
      {windows.map((window, index) => (
        <AppWindow
          key={window.id}
          window={window}
          program={programs.find((program) => program.id === window.id)!}
          active={activeId === window.id}
          index={index}
          dispatch={dispatch}
        >
          <ProgramContents
            id={window.id}
            visible={!window.minimized && pageVisible}
            connection={connection}
          />
        </AppWindow>
      ))}
      <Taskbar
        windows={windows}
        activeId={activeId}
        dispatch={dispatch}
        connection={connection}
      />
    </main>
  );
}

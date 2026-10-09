import { useCallback, useEffect, useReducer, useState } from "react";
import { DesktopProgramIcon } from "../branding/desktop-program-icon.js";
import type {
  AccountProfile,
  MediaRoot,
  TmdbKeyStatus,
} from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";
import { ProgramContents } from "../program-host/program-contents.js";
import { TmdbTrayReminder } from "../tmdb-reminder/tmdb-tray-reminder.js";
import { LogOffDialog } from "./chrome/log-off-dialog.js";
import { Taskbar } from "./chrome/taskbar.js";
import { programs } from "./programs.js";
import { AppWindow } from "./windows/app-window.js";
import { windowReducer } from "./windows/window-state.js";
import type { DesktopViewport } from "./contracts.js";

/** Reads the desktop area above the 32px taskbar from the browser window. */
function usableViewport(): DesktopViewport {
  return {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight - 32,
  };
}

/**
 * Composes shell presentation with real programs, leaving domain state
 * entirely API-backed. The app root renders it only for a logged-in browser;
 * its `/health` poll drives the tray connection indicator alone. While the
 * Log Off confirmation is open, the desktop behind it is inert. The account
 * comes from the app root, which alone holds it, so a change made in Account
 * Settings goes back up through `onAccountChanged` and redraws everything.
 * The shell also owns whether a TMDB key is set, for the tray reminder; a save
 * in Account Settings re-reads it through `onTmdbKeyChanged`.
 */
export function DesktopShell({
  account,
  onAccountChanged,
  onLoggedOff,
}: {
  account: AccountProfile;
  onAccountChanged: (account: AccountProfile) => void;
  onLoggedOff: () => void;
}) {
  const [windows, dispatch] = useReducer(windowReducer, []);
  const [viewport, setViewport] = useState(usableViewport);
  const [loggingOff, setLoggingOff] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    document.visibilityState !== "hidden",
  );
  const health = useResource<{ status: string }>(
    "/health",
    pageVisible,
    10_000,
  );
  const tmdbKey = useResource<TmdbKeyStatus>("/metadata/tmdb-key", pageVisible);
  const mediaRoots = useResource<MediaRoot[]>("/media-roots", pageVisible);
  // Counts requests to open Account Settings on the TMDB task, so a repeat
  // request still reaches a window that is already open. It restarts at 0
  // when that window closes, so a later plain open shows its home page.
  const [tmdbTaskRequest, setTmdbTaskRequest] = useState(0);
  if (
    tmdbTaskRequest !== 0 &&
    !windows.some((window) => window.id === "account")
  )
    setTmdbTaskRequest(0);
  /** Opens or focuses Account Settings and asks it for the Set up TMDB task. */
  const openTmdbTask = useCallback(() => {
    dispatch({ type: "open", id: "account" });
    setTmdbTaskRequest((count) => count + 1);
  }, []);
  useEffect(() => {
    /** Windows clamp to the live viewport at render, so shrinking never loses their saved positions. */
    const resize = () => setViewport(usableViewport());
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
  return (
    <>
      <main className="desktop-shell" inert={loggingOff}>
        <div className="desktop-shortcuts" aria-label="Desktop programs">
          {programs.map((program) => (
            <button
              key={program.id}
              className="desktop-shortcut"
              title={program.description}
              onClick={() => dispatch({ type: "open", id: program.id })}
            >
              <DesktopProgramIcon
                program={program.id}
                avatarId={account.avatarId}
                size={54}
              />
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
        {/* DOM order stays fixed and z-index carries stacking: moving a pressed window's node would make the browser drop its click. */}
        {[...windows]
          .sort((a, b) => a.openedOrder - b.openedOrder)
          .map((window) => (
            <AppWindow
              key={window.id}
              window={window}
              program={programs.find((program) => program.id === window.id)!}
              avatarId={account.avatarId}
              active={activeId === window.id}
              index={windows.indexOf(window)}
              viewport={viewport}
              dispatch={dispatch}
            >
              <ProgramContents
                id={window.id}
                visible={!window.minimized && pageVisible}
                connection={connection}
                account={account}
                onAccountChanged={onAccountChanged}
                tmdbTaskRequest={tmdbTaskRequest}
                onTmdbKeyChanged={tmdbKey.refresh}
              />
            </AppWindow>
          ))}
        <Taskbar
          windows={windows}
          activeId={activeId}
          dispatch={dispatch}
          connection={connection}
          avatarId={account.avatarId}
          logOff={() => setLoggingOff(true)}
          tray={
            <TmdbTrayReminder
              configured={tmdbKey.data?.configured}
              hasMediaRoots={
                mediaRoots.data === undefined
                  ? undefined
                  : mediaRoots.data.length > 0
              }
              onSetUp={openTmdbTask}
            />
          }
        />
      </main>
      {loggingOff && (
        <LogOffDialog
          onCancel={() => setLoggingOff(false)}
          onLoggedOff={onLoggedOff}
        />
      )}
    </>
  );
}

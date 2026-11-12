import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DesktopProgramIcon } from "../branding/icons/desktop-program-icon.js";
import type { AccountProfile } from "../http/contracts/auth.js";
import type { MediaRoot } from "../http/contracts/media.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { Tooltip } from "../controls/popups/tooltip.js";
import { RefreshScope } from "../http/resources/refresh-scope.js";
import { useResource } from "../http/resources/use-resource.js";
import { CANT_REACH_WORDS } from "../http/api-client.js";
import { ProgramContents } from "../program-host/program-contents.js";
import { isScanRunning } from "../media-library/scan-progress/use-scan-job.js";
import {
  lookupsRunning,
  trayReminders,
} from "../tray-reminders/tray-reminder-list.js";
import { TrayReminders } from "../tray-reminders/tray-reminders.js";
import type { WatchRequest } from "../tv/tv-app.js";
import { navigateWithArrows } from "../controls/arrow-navigation/arrow-navigation.js";
import { LogOffDialog } from "./chrome/log-off-dialog.js";
import { Taskbar } from "./chrome/taskbar.js";
import type {
  DesktopViewport,
  DesktopWindow,
  ProgramId,
  ProgramTask,
  WindowAction,
} from "./contracts.js";
import { programOf, programs } from "./programs.js";
import { AppWindow } from "./windows/app-window.js";
import { readWindowMemory, rememberWindows } from "./windows/window-memory.js";
import { usePropertiesWindows } from "./windows/use-properties-windows.js";
import { windowReducer } from "./windows/window-state.js";

/** The taskbar's height; `--xp-taskbar-height` in xp-tokens.css draws it. */
const TASKBAR_HEIGHT_PX = 32;

/** How often the shell re-reads the media roots while a scan or lookup runs. */
const JOB_POLL_MS = 3_000;

/** Reads the desktop area above the taskbar from the browser window. */
function usableViewport(): DesktopViewport {
  return {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight - TASKBAR_HEIGHT_PX,
  };
}

/**
 * Composes shell presentation with real programs, leaving domain state
 * entirely API-backed. The app root renders it only for a logged-in browser;
 * its `/health` poll drives the tray connection indicator alone. While the
 * Log Off confirmation is open, the desktop behind it is inert. The account
 * comes from the app root, which alone holds it, so a change made in Account
 * Settings goes back up through `onAccountChanged` and redraws everything.
 * The shell also reads whether a TMDB key is set and the media roots, for the
 * tray reminders; a save in Account Settings re-reads the key through
 * `onTmdbKeyChanged`, and a program that starts a scan or lookup re-reads
 * the roots through `onScanJobStarted`, so the tray follows the job.
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
  // Where this browser last left each window, read once at start; every
  // change is written back, so a program reopens where it was left.
  const memory = useRef(readWindowMemory());
  const [windows, dispatch] = useReducer(
    (state: DesktopWindow[], action: WindowAction) =>
      windowReducer(state, action, memory.current),
    [],
  );
  useEffect(() => {
    memory.current = rememberWindows(memory.current, windows);
  }, [windows]);
  const properties = usePropertiesWindows(dispatch);
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
  // Polled only while some root's job runs, so the tray's lookup count
  // moves and the reminders see the jobs end; otherwise read as the page
  // starts, shows again, or a program says it started a job.
  const [jobsRunning, setJobsRunning] = useState(false);
  const mediaRoots = useResource<MediaRoot[]>(
    "/media-roots",
    pageVisible,
    jobsRunning ? JOB_POLL_MS : 0,
  );
  const anyJobRunning =
    mediaRoots.data?.some(
      (root) => root.scan !== null && isScanRunning(root.scan),
    ) ?? false;
  if (anyJobRunning !== jobsRunning) setJobsRunning(anyJobRunning);
  // Counts requests to open Account Settings on the TMDB task, so a repeat
  // request still reaches a window that is already open. It restarts at 0
  // when that window closes, so a later plain open shows its home page.
  const [tmdbTaskRequest, setTmdbTaskRequest] = useState(0);
  if (
    tmdbTaskRequest !== 0 &&
    !windows.some((window) => window.id === "account")
  )
    setTmdbTaskRequest(0);
  /**
   * Opens or focuses a program. Asked for the Set up TMDB task, it also asks
   * Account Settings to show that task. Stable, so memoized program contents
   * never re-render for it.
   */
  const openProgram = useCallback((id: ProgramId, task?: ProgramTask) => {
    dispatch({ type: "open", id });
    if (task === "set-up-tmdb") setTmdbTaskRequest((count) => count + 1);
  }, []);
  // The latest request to watch a channel on TV, counted like the TMDB task
  // request and cleared once TV closes, so a plain open later starts on the
  // channel TV was last left on.
  const [watchRequest, setWatchRequest] = useState<WatchRequest>();
  if (watchRequest && !windows.some((window) => window.id === "tv"))
    setWatchRequest(undefined);
  /** Opens or focuses TV and tunes it to the channel. */
  const watchChannel = useCallback((channelId: string) => {
    dispatch({ type: "open", id: "tv" });
    setWatchRequest((request) => ({
      channelId,
      count: (request?.count ?? 0) + 1,
    }));
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
  // Worded for the owner, who knows kraziTV, not its API.
  const online = !health.error && health.data?.status === "ok";
  const connection = health.error
    ? CANT_REACH_WORDS
    : online
      ? "kraziTV is running"
      : "Checking on kraziTV…";
  const activeId = windows.filter((window) => !window.minimized).at(-1)?.id;
  return (
    <>
      <main className="desktop-shell" inert={loggingOff}>
        {/* One column of icons, which the arrow keys move through as Start's. */}
        <div
          className="desktop-shortcuts"
          aria-label="Desktop programs"
          onKeyDown={(event) =>
            navigateWithArrows(event, [event.currentTarget])
          }
        >
          {programs.map((program) => (
            <Tooltip
              key={program.id}
              id={`shortcut-tip-${program.id}`}
              text={program.description}
            >
              <button
                className="desktop-shortcut"
                aria-describedby={`shortcut-tip-${program.id}`}
                onClick={() => dispatch({ type: "open", id: program.id })}
              >
                <DesktopProgramIcon
                  program={program.id}
                  avatarId={account.avatarId}
                  size={54}
                />
                <span>{program.name}</span>
              </button>
            </Tooltip>
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
              program={programOf(window.id)}
              title={properties.titleOf(window.id)}
              unsavedName={properties.unsavedName(window.id)}
              avatarId={account.avatarId}
              active={activeId === window.id}
              index={windows.indexOf(window)}
              viewport={viewport}
              dispatch={dispatch}
            >
              {/* Bringing a window to the front reloads what it shows. */}
              <RefreshScope active={activeId === window.id}>
                <ProgramContents
                  id={window.id}
                  visible={!window.minimized && pageVisible}
                  connection={connection}
                  account={account}
                  onAccountChanged={onAccountChanged}
                  tmdbTaskRequest={tmdbTaskRequest}
                  onTmdbKeyChanged={tmdbKey.refresh}
                  onScanJobStarted={mediaRoots.refresh}
                  openProgram={openProgram}
                  watchRequest={watchRequest}
                  watchChannel={watchChannel}
                  channelWindows={properties.channels}
                  collectionWindows={properties.collections}
                  markUnsaved={properties.markUnsaved}
                />
              </RefreshScope>
            </AppWindow>
          ))}
        <Taskbar
          windows={windows}
          activeId={activeId}
          titleOf={properties.titleOf}
          dispatch={dispatch}
          connection={connection}
          online={online}
          avatarId={account.avatarId}
          displayName={account.displayName}
          logOff={() => setLoggingOff(true)}
          tray={
            <TrayReminders
              reminders={trayReminders({
                tmdbKey: tmdbKey.data,
                mediaRoots: mediaRoots.data,
                setUpTmdb: () => openProgram("account", "set-up-tmdb"),
              })}
              status={lookupsRunning(mediaRoots.data)}
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

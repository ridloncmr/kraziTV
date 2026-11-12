import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DesktopProgramIcon } from "../branding/icons/desktop-program-icon.js";
import type { AccountProfile } from "../http/contracts/auth.js";
import type { Recommendation } from "../http/contracts/collections.js";
import type { MediaRoot } from "../http/contracts/media.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { Tooltip } from "../controls/popups/tooltip.js";
import { RefreshScope } from "../http/resources/refresh-scope.js";
import { useResource } from "../http/resources/use-resource.js";
import { CANT_REACH_WORDS } from "../http/api-client.js";
import { ProgramContents } from "../program-host/program-contents.js";
import { lookUpEveryRoot } from "../scan-jobs/every-root-lookup.js";
import { anyRootJobRunning } from "../scan-jobs/scan-running.js";
import {
  filesLeftToLookUp,
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
 * tray reminders; a key saved or removed in Account Settings re-reads the
 * roots and then the key through `onTmdbKeyChanged`, and a program that
 * starts a scan or lookup re-reads the roots through `onScanJobStarted`, so
 * the tray follows the job. Each time the library settles with nothing left
 * to look up, it also reads the collection recommendations for the
 * Collections ready reminder, which counts nothing until that read answers,
 * and re-reads them through
 * `onRecommendationDecided` whenever Discover decides one, so the tray
 * counts only what is still to decide.
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
  const anyJobRunning = anyRootJobRunning(mediaRoots.data ?? []);
  if (anyJobRunning !== jobsRunning) setJobsRunning(anyJobRunning);
  // Set while a changed key waits for the roots read it asked for. Read
  // together, the key could land first beside roots from before its lookup
  // started, and Files not looked up would hold for a moment and spend its
  // one automatic open (spec 0006).
  const keyAwaitsRoots = useRef(false);
  const { refresh: refreshTmdbKey } = tmdbKey;
  const { refresh: refreshMediaRoots } = mediaRoots;
  /** A key was saved or removed: re-reads the roots, then the key. */
  const tmdbKeyChanged = useCallback(() => {
    keyAwaitsRoots.current = true;
    refreshMediaRoots();
  }, [refreshMediaRoots]);
  // A roots read answering, or failing, lets a waiting key be read.
  useEffect(() => {
    if (!keyAwaitsRoots.current) return;
    keyAwaitsRoots.current = false;
    refreshTmdbKey();
  }, [mediaRoots.data, mediaRoots.error, refreshTmdbKey]);
  // Read only while nothing is left to look up, the one time Collections
  // ready can hold, so a library being looked up is never asked for them.
  const settled = filesLeftToLookUp(tmdbKey.data, mediaRoots.data) === 0;
  const recommendations = useResource<Recommendation[]>(
    "/media-collections/recommendations",
    pageVisible && settled,
  );
  // The answer held while the library was last unsettled. The hook keeps it
  // until the read made for the next settle lands, and `loading` only turns
  // on in the effect after that render, so the tray is given nothing until
  // a new answer replaces it and never counts what an earlier lookup left.
  // A hidden page unsettles nothing, so a shown balloon survives a tab
  // switch.
  const [outdatedRecommendations, setOutdatedRecommendations] =
    useState<Recommendation[]>();
  if (!settled && recommendations.data !== outdatedRecommendations)
    setOutdatedRecommendations(recommendations.data);
  const currentRecommendations =
    recommendations.data === outdatedRecommendations
      ? undefined
      : recommendations.data;
  // Counts requests to open Account Settings on the TMDB task, so a repeat
  // request still reaches a window that is already open. It restarts at 0
  // when that window closes, so a later plain open shows its home page.
  const [tmdbTaskRequest, setTmdbTaskRequest] = useState(0);
  if (
    tmdbTaskRequest !== 0 &&
    !windows.some((window) => window.id === "account")
  )
    setTmdbTaskRequest(0);
  // Counts requests to open Collections on Discover, as the TMDB task's
  // are counted, and restarts at 0 when Collections closes.
  const [discoverRequest, setDiscoverRequest] = useState(0);
  if (
    discoverRequest !== 0 &&
    !windows.some((window) => window.id === "collections")
  )
    setDiscoverRequest(0);
  /**
   * Opens or focuses a program. Asked for a task, it also asks the program
   * to show it: Account Settings its Set up TMDB task, Collections its
   * Discover dialog. Stable, so memoized program contents never re-render
   * for it.
   */
  const openProgram = useCallback((id: ProgramId, task?: ProgramTask) => {
    dispatch({ type: "open", id });
    if (task === "set-up-tmdb") setTmdbTaskRequest((count) => count + 1);
    if (task === "discover-collections")
      setDiscoverRequest((count) => count + 1);
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
                  discoverRequest={discoverRequest}
                  onTmdbKeyChanged={tmdbKeyChanged}
                  onScanJobStarted={refreshMediaRoots}
                  onRecommendationDecided={recommendations.refresh}
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
                recommendations: currentRecommendations,
                setUpTmdb: () => openProgram("account", "set-up-tmdb"),
                // The tray lives in the shell, so it re-reads the roots itself.
                lookUpFiles: () => void lookUpEveryRoot(refreshMediaRoots),
                makeCollections: () =>
                  openProgram("collections", "discover-collections"),
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

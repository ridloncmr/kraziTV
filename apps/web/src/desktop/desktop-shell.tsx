import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DesktopProgramIcon } from "../branding/desktop-program-icon.js";
import type { AccountProfile } from "../http/contracts/auth.js";
import type { Channel } from "../http/contracts/channels.js";
import type { MediaRoot } from "../http/contracts/media.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { Tooltip } from "../controls/tooltip.js";
import { RefreshScope } from "../http/resources/refresh-scope.js";
import { useResource } from "../http/resources/use-resource.js";
import { ProgramContents } from "../program-host/program-contents.js";
import { TmdbTrayReminder } from "../tmdb-reminder/tmdb-tray-reminder.js";
import { LogOffDialog } from "./chrome/log-off-dialog.js";
import { Taskbar } from "./chrome/taskbar.js";
import type {
  DesktopViewport,
  DesktopWindow,
  ProgramId,
  WindowAction,
} from "./contracts.js";
import { programById, programs } from "./programs.js";
import { AppWindow } from "./windows/app-window.js";
import { readWindowMemory, rememberWindows } from "./windows/window-memory.js";
import { windowReducer } from "./windows/window-state.js";

/** The taskbar's height; `--xp-taskbar-height` in xp-tokens.css draws it. */
const TASKBAR_HEIGHT_PX = 32;

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
  // Stable, so memoized program contents never re-render for it.
  const openProgram = useCallback(
    (id: ProgramId) => dispatch({ type: "open", id }),
    [],
  );
  // The channel Channel Properties shows, as last read; set when My Channels
  // opens one and whenever the window reads it again.
  const [propertiesChannel, setPropertiesChannel] = useState<Channel>();
  /** Opens or focuses Channel Properties on a channel. */
  const showChannelProperties = useCallback((channel: Channel) => {
    setPropertiesChannel(channel);
    dispatch({ type: "open", id: "channel-properties" });
  }, []);
  /**
   * Takes a fresh read of the channel shown. A read of a channel picked
   * before it is ignored, and one that changed nothing keeps the title and
   * list from redrawing.
   */
  const channelRead = useCallback(
    (channel: Channel) =>
      setPropertiesChannel((current) =>
        current?.id !== channel.id ||
        (current.number === channel.number &&
          current.name === channel.name &&
          current.enabled === channel.enabled)
          ? current
          : channel,
      ),
    [],
  );
  /** Closes Channel Properties, as after its channel is deleted. */
  const closeChannelProperties = useCallback(
    () => dispatch({ type: "close", id: "channel-properties" }),
    [],
  );
  const propertiesOpen = windows.some(
    (window) => window.id === "channel-properties",
  );
  /** A window's title: Channel Properties names its channel, as XP's did. */
  const titleOf = useCallback(
    (id: ProgramId) =>
      id === "channel-properties" && propertiesChannel
        ? `${propertiesChannel.name} Properties`
        : programById(id).name,
    [propertiesChannel],
  );
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
              program={programById(window.id)}
              title={titleOf(window.id)}
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
                  openProgram={openProgram}
                  propertiesChannel={
                    propertiesOpen ? propertiesChannel : undefined
                  }
                  showChannelProperties={showChannelProperties}
                  channelRead={channelRead}
                  closeChannelProperties={closeChannelProperties}
                />
              </RefreshScope>
            </AppWindow>
          ))}
        <Taskbar
          windows={windows}
          activeId={activeId}
          titleOf={titleOf}
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

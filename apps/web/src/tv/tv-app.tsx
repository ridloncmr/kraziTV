import { useEffect, useRef, useState } from "react";
import { ChannelNowNext } from "../channel-observation/channel-now-next.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import { apiUrl, resourcePath } from "../http/api-client.js";
import type { Channel } from "../http/contracts/channels.js";
import { useResource } from "../http/resources/use-resource.js";
import { startBroadcast } from "./broadcast-player.js";
import { startingChannel, stepChannel } from "./channel-dial.js";
import { ScreenMessage, type ScreenState } from "./screen-message.js";
import { readTvMemory, rememberTv } from "./tv-memory.js";

/** A request from My Channels or the Program Guide to watch one channel. */
export interface WatchRequest {
  channelId: string;
  /** Counts requests, so watching the same channel again still reaches an open TV. */
  count: number;
}

/**
 * TV: one channel's broadcast signal in the browser, as a viewer that
 * subscribes to it like any Plex client, with CH ▲/▼, a channel list, what
 * airs now and next, volume, and full screen. It never decides what plays;
 * the picture and the strip under it are what the server sends. Closing the
 * window or changing channel ends this viewer's subscription.
 */
export function TvApp({
  visible,
  request,
  onOpenChannels,
}: {
  visible: boolean;
  request: WatchRequest | undefined;
  onOpenChannels: () => void;
}) {
  const channels = useResource<Channel[]>("/channels", visible);
  const [memory] = useState(readTvMemory);
  const [chosenId, setChosenId] = useState(memory.channelId);
  const [volume, setVolume] = useState(memory.volume);
  const [muted, setMuted] = useState(memory.muted);
  // Adjusted during render, like Account Settings' task request, so a
  // Watch request tunes on the first paint after it arrives.
  const [handledRequest, setHandledRequest] = useState(0);
  if (request && request.count !== handledRequest) {
    setHandledRequest(request.count);
    setChosenId(request.channelId);
  }
  // The channel on screen, so a choice missing from a list read before it
  // existed keeps this channel until the list is read again, instead of
  // tuning the first one in between.
  const [shownId, setShownId] = useState<string>();
  const tuned =
    channels.data && startingChannel(channels.data, [chosenId, shownId]);
  if (tuned?.id !== shownId) setShownId(tuned?.id);
  const { data: lineup, refresh: refreshLineup } = channels;
  // Each missing choice reads the list once more; a deleted channel would
  // otherwise read it forever.
  const rereadFor = useRef<string>(undefined);
  useEffect(() => {
    /** A Watch for a channel newer than this list reads the list again. */
    if (
      lineup &&
      chosenId !== undefined &&
      chosenId !== rereadFor.current &&
      !lineup.some((channel) => channel.id === chosenId)
    ) {
      rereadFor.current = chosenId;
      refreshLineup();
    }
  }, [lineup, chosenId, refreshLineup]);
  const [screen, setScreen] = useState<ScreenState>({ kind: "tuning" });
  // Bumped by Try again, so the same channel tunes afresh.
  const [attempt, setAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const tunedId = tuned?.id;

  useEffect(() => {
    /** Tunes the channel; the cleanup ends the subscription when the channel changes or the window closes. */
    const element = video.current;
    if (!tunedId || !element) return;
    setScreen({ kind: "tuning" });
    let current = true;
    const playback = startBroadcast(
      element,
      apiUrl(`${resourcePath("channels", tunedId)}/stream`),
      (problem) => {
        if (current) setScreen({ kind: "problem", problem });
      },
    );
    /**
     * A browser that blocks sound until a click gets a button for it. Any
     * other refusal follows a failure already reported, which stays shown.
     */
    playback.play().catch((error: unknown) => {
      if (current && isAutoplayRefusal(error))
        setScreen((state) =>
          state.kind === "problem" ? state : { kind: "blocked" },
        );
    });
    return () => {
      current = false;
      playback.stop();
    };
  }, [tunedId, attempt]);

  useEffect(() => {
    /** Keeps the element's sound and this browser's memory in step with the controls. */
    if (video.current) {
      video.current.volume = volume;
      video.current.muted = muted;
    }
    rememberTv({
      // Before the list arrives, or with nothing to tune, the last choice stays.
      ...((tunedId ?? chosenId) === undefined
        ? {}
        : { channelId: tunedId ?? chosenId }),
      volume,
      muted,
    });
  }, [tunedId, chosenId, volume, muted]);

  useEffect(() => {
    /** The full screen button names what it will do, however full screen ended. */
    const changed = () =>
      setFullScreen(document.fullscreenElement === picture.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  /**
   * Enters or leaves full screen for the picture alone; Esc also leaves. A
   * browser that refuses leaves the window as it was.
   */
  const toggleFullScreen = () => {
    const change = document.fullscreenElement
      ? document.exitFullscreen()
      : picture.current?.requestFullscreen();
    change?.catch(() => {});
  };
  /** Moves up or down the lineup, skipping disabled channels. */
  const step = (direction: 1 | -1) => {
    const next =
      channels.data && stepChannel(channels.data, tunedId, direction);
    if (next) setChosenId(next.id);
  };
  const enabledCount =
    channels.data?.filter((channel) => channel.enabled).length ?? 0;

  return (
    <div className="program-page tv-page">
      <div
        ref={picture}
        className="tv-picture"
        // Only the picture itself, so double-clicking a screen button does not.
        onDoubleClick={(event) => {
          if (event.target === video.current) toggleFullScreen();
        }}
      >
        <video
          ref={video}
          className="tv-video"
          aria-label={tuned ? `${tuned.number} ${tuned.name}` : "TV picture"}
          playsInline
          // Buffered picture can start or resume after the stream already
          // stopped, so playing never hides why it stopped.
          onPlaying={() =>
            setScreen((state) =>
              state.kind === "problem" ? state : { kind: "playing" },
            )
          }
          // A decode failure the player does not report still says why.
          onError={() =>
            setScreen({ kind: "problem", problem: { kind: "unplayable" } })
          }
        />
        {tuned && (
          <div key={`${tuned.id}-${attempt}`} className="tv-banner">
            <strong>{tuned.number}</strong> {tuned.name}
          </div>
        )}
        <ScreenMessage
          state={screen}
          channels={channels.data}
          tuned={tuned}
          onOpenChannels={onOpenChannels}
          onPlay={() => {
            video.current?.play().catch(() => {});
          }}
          onRetry={() => {
            channels.refresh();
            setAttempt((count) => count + 1);
          }}
        />
      </div>
      <div className="tv-now" aria-label="On now">
        {tuned ? (
          <ChannelNowNext channel={tuned} visible={visible} />
        ) : (
          <span className="secondary">No channel tuned</span>
        )}
      </div>
      <div className="tv-controls" role="group" aria-label="TV controls">
        <button
          aria-label="Channel up"
          disabled={enabledCount < 2}
          onClick={() => step(1)}
        >
          CH ▲
        </button>
        <button
          aria-label="Channel down"
          disabled={enabledCount < 2}
          onClick={() => step(-1)}
        >
          CH ▼
        </button>
        <select
          aria-label="Channel"
          value={tunedId ?? ""}
          disabled={enabledCount === 0}
          onChange={(event) => setChosenId(event.target.value)}
        >
          {!tuned && <option value="">No channel</option>}
          {channels.data?.map((channel) => (
            <option
              key={channel.id}
              value={channel.id}
              disabled={!channel.enabled}
            >
              {channel.number} · {channel.name}
              {channel.enabled ? "" : " (disabled)"}
            </option>
          ))}
        </select>
        <span className="tv-spacer" />
        <button onClick={() => setMuted((value) => !value)}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => {
            setVolume(Number(event.target.value));
            setMuted(false);
          }}
        />
        <button onClick={toggleFullScreen}>
          {fullScreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      <RequestFeedback loading={channels.loading} error={channels.error} />
    </div>
  );
}

/** Whether a refused play is the browser waiting for a click before sound. */
function isAutoplayRefusal(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

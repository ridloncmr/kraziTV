import type Mpegts from "mpegts.js";

/** Why the picture stopped: what the TV says over its screen. */
export type BroadcastProblem =
  | { kind: "refused"; status: number }
  | { kind: "unreachable" }
  | { kind: "ended" }
  | { kind: "unplayable" };

/** One channel's broadcast signal playing into a video element. */
export interface BroadcastPlayback {
  /** Starts the picture; rejects when the browser wants a click first. */
  play(): Promise<void>;
  /** Stops reading the stream, which ends this viewer's subscription. */
  stop(): void;
}

/**
 * Plays a channel's MPEG-TS stream into `video` through mpegts.js, which
 * remuxes it for Media Source Extensions. The stream is live, so the player
 * never seeks or chases the live edge: the server's join backlog (ADR 0018)
 * fills the buffer, and splices already run forward (ADR 0021). mpegts.js
 * loads on the first tune, so the desktop never downloads it unless TV
 * plays. Every way the stream can stop arrives once through `onProblem`,
 * and nothing arrives after `stop`.
 */
export function startBroadcast(
  video: HTMLVideoElement,
  url: string,
  onProblem: (problem: BroadcastProblem) => void,
): BroadcastPlayback {
  let reported = false;
  /** Reports only the first problem, since one stop can raise several events. */
  const report = (problem: BroadcastProblem) => {
    if (reported) return;
    reported = true;
    onProblem(problem);
  };
  // Held once loaded, so stopping destroys it at once, before a later
  // player can attach to the same video element.
  let loaded: Mpegts.Player | undefined;
  const player = import("mpegts.js").then(
    ({ default: mpegts }) => {
      // Stopped while loading, or a browser without live Media Source
      // playback, as some phones are: nothing to start.
      if (reported) return undefined;
      if (!mpegts.getFeatureList().mseLivePlayback) {
        report({ kind: "unplayable" });
        return undefined;
      }
      loaded = load(mpegts, video, url, report);
      return loaded;
    },
    () => {
      // The code itself could not be fetched, so kraziTV is out of reach.
      report({ kind: "unreachable" });
      return undefined;
    },
  );
  return {
    play: async () => {
      await (await player)?.play();
    },
    stop: () => {
      reported = true;
      loaded?.destroy();
      loaded = undefined;
    },
  };
}

/** Creates the player, maps its events onto problems, and starts loading the stream. */
function load(
  mpegts: typeof Mpegts,
  video: HTMLVideoElement,
  url: string,
  report: (problem: BroadcastProblem) => void,
): Mpegts.Player {
  const player = mpegts.createPlayer(
    { type: "mpegts", isLive: true, url },
    { enableWorker: false, liveBufferLatencyChasing: false },
  );
  player.on(
    mpegts.Events.ERROR,
    (type: string, detail: string, info?: { code?: number }) => {
      if (type !== mpegts.ErrorTypes.NETWORK_ERROR) {
        report({ kind: "unplayable" });
      } else if (
        detail === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID &&
        typeof info?.code === "number"
      ) {
        report({ kind: "refused", status: info.code });
      } else {
        report({ kind: "unreachable" });
      }
    },
  );
  player.on(mpegts.Events.LOADING_COMPLETE, () => report({ kind: "ended" }));
  player.attachMediaElement(video);
  player.load();
  return player;
}

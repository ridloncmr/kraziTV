import type {
  BroadcastPlayback,
  BroadcastProblem,
} from "../tv/broadcast-player.js";

/** One broadcast the TV started, as `startBroadcast` was called for it. */
interface StartedBroadcast {
  url: string;
  video: HTMLVideoElement;
  /** Reports a problem as the real player does: once, and never after stop. */
  fail(problem: BroadcastProblem): void;
  /** Rejects a held play, as the element's play does with a `DOMException` of that name. */
  rejectPlay(name: string): void;
  stopped: boolean;
}

/**
 * Stands in for `startBroadcast`, which needs Media Source Extensions jsdom
 * lacks, recording each broadcast so a test can see which channel is tuned,
 * fail it, and check it was stopped. Plays resolve at once unless
 * `refusePlay` rejects them as a browser blocking sound does, or `holdPlay`
 * keeps them pending until `rejectPlay`, as a real play waits for frames.
 */
export class FakeBroadcasts {
  readonly started: StartedBroadcast[] = [];
  refusePlay = false;
  holdPlay = false;

  /** The broadcast tuned last. */
  get latest(): StartedBroadcast | undefined {
    return this.started.at(-1);
  }

  /** Matches `startBroadcast`'s signature, so a module mock can return it. */
  start = (
    video: HTMLVideoElement,
    url: string,
    onProblem: (problem: BroadcastProblem) => void,
  ): BroadcastPlayback => {
    let reported = false;
    let rejectHeld: ((error: DOMException) => void) | undefined;
    const broadcast: StartedBroadcast = {
      url,
      video,
      stopped: false,
      fail: (problem) => {
        if (reported) return;
        reported = true;
        onProblem(problem);
      },
      rejectPlay: (name) => rejectHeld?.(new DOMException(name, name)),
    };
    this.started.push(broadcast);
    return {
      play: () => {
        if (this.refusePlay)
          return Promise.reject(
            new DOMException("Click first", "NotAllowedError"),
          );
        if (!this.holdPlay) return Promise.resolve();
        return new Promise<void>((_, reject) => {
          rejectHeld = reject;
        });
      },
      stop: () => {
        reported = true;
        broadcast.stopped = true;
      },
    };
  };

  /** Forgets every broadcast, between tests. */
  reset(): void {
    this.started.length = 0;
    this.refusePlay = false;
    this.holdPlay = false;
  }
}

/** The one fake the TV app's module mock hands out. */
export const fakeBroadcasts = new FakeBroadcasts();

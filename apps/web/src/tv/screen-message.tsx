import type { Channel } from "../http/contracts/channels.js";
import type { BroadcastProblem } from "./broadcast-player.js";

/** What the screen shows besides the picture. */
export type ScreenState =
  | { kind: "tuning" }
  | { kind: "playing" }
  | { kind: "blocked" }
  | { kind: "problem"; problem: BroadcastProblem };

/**
 * What the screen says over the picture: nothing while it plays, a prompt
 * when the browser wants a click before sound, and otherwise why there is
 * no picture, with a way on.
 */
export function ScreenMessage({
  state,
  channels,
  tuned,
  onOpenChannels,
  onPlay,
  onRetry,
}: {
  state: ScreenState;
  channels: Channel[] | undefined;
  tuned: Channel | undefined;
  onOpenChannels: () => void;
  onPlay: () => void;
  onRetry: () => void;
}) {
  if (channels && !tuned)
    return (
      <div className="tv-message">
        <strong>No signal</strong>
        <span>
          {channels.length === 0
            ? "No channels yet. Create one in My Channels."
            : "Every channel is disabled. Enable one in My Channels."}
        </span>
        <button onClick={onOpenChannels}>Open My Channels</button>
      </div>
    );
  if (state.kind === "playing" || !tuned) return null;
  if (state.kind === "tuning")
    return (
      <div className="tv-message" role="status">
        <span>Tuning…</span>
      </div>
    );
  if (state.kind === "blocked")
    return (
      <div className="tv-message">
        <button onClick={onPlay}>Turn on the TV</button>
      </div>
    );
  return (
    <div className="tv-message" role="alert">
      <strong>No signal</strong>
      <span>{problemWords(state.problem)}</span>
      <button onClick={onRetry}>Try again</button>
    </div>
  );
}

/** Says in the owner's words why the picture stopped. */
function problemWords(problem: BroadcastProblem): string {
  switch (problem.kind) {
    case "refused":
      if (problem.status === 409)
        // The server also answers 409 for a channel disabled since the list was read.
        return "This channel has nothing on air, or was just disabled.";
      if (problem.status === 404) return "This channel no longer exists.";
      if (problem.status === 503)
        return "The channel couldn't start its broadcast.";
      return "kraziTV couldn't send this channel.";
    case "unreachable":
      return "Can't reach kraziTV.";
    case "ended":
      return "The broadcast stopped.";
    case "unplayable":
      return "This browser can't play the broadcast.";
  }
}

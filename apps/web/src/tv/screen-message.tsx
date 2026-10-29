import { useEffect, useState } from "react";
import { POPUP_MS } from "../desktop/chrome/xp-motion.js";
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
 * no picture, with a way on. Tuning… fades out over one popup beat when
 * the picture starts, instead of vanishing.
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
  // Adjusted during render, so the first playing paint still draws Tuning…
  // and its fade starts from it; any other change ends the fade at once.
  const [seenKind, setSeenKind] = useState(state.kind);
  const [fading, setFading] = useState(false);
  if (state.kind !== seenKind) {
    setSeenKind(state.kind);
    setFading(seenKind === "tuning" && state.kind === "playing");
  }
  useEffect(() => {
    /** Unmounts the faded Tuning… once its transition, which tv.css draws, has played. */
    if (!fading) return;
    const timer = setTimeout(() => setFading(false), POPUP_MS);
    return () => clearTimeout(timer);
  }, [fading]);

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
  if (!tuned || (state.kind === "playing" && !fading)) return null;
  if (state.kind === "tuning" || state.kind === "playing")
    return (
      <div className={`tv-message${fading ? " fading" : ""}`} role="status">
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

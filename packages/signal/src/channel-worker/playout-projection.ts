import { SignalError } from "../errors.js";
import type {
  ChannelId,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  SelectedPlayoutItem,
} from "../playout/contracts.js";
import type { TimestampMs } from "../runtime/clock.js";
import type { SignalPlayoutItem } from "../signal-packager/contracts.js";

export type CurrentPlayout = Extract<
  CurrentPlayoutResult,
  { status: "current" }
>;

/** Converts one atomic current-state projection into route-safe failures. */
export function requireCurrent(
  result: CurrentPlayoutResult,
  channelId: ChannelId,
): CurrentPlayout {
  if (result.channelId !== channelId) {
    throw invalidItem(channelId, "channel_mismatch");
  }
  if (result.status === "no_current") {
    throw new SignalError(
      result.reason === "media_unavailable"
        ? "media_unavailable"
        : "no_current_playout",
      result.reason === "media_unavailable"
        ? `Current media is unavailable for channel ${channelId}`
        : `Channel ${channelId} has no current playout item`,
      {
        channelId,
        reason: result.reason,
        ...(result.scheduleEntryId === undefined
          ? {}
          : { scheduleEntryId: result.scheduleEntryId }),
      },
    );
  }
  if (result.item.channelId !== channelId) {
    throw invalidItem(channelId, "item_channel_mismatch");
  }
  if (result.scheduleRevision !== result.item.scheduleRevision) {
    throw invalidItem(channelId, "schedule_revision_mismatch");
  }
  return result;
}

/** Preserves the absolute end while translating selected playout for packaging. */
export function toSignalItem(
  current: CurrentPlayout,
  channelId: ChannelId,
): SignalPlayoutItem {
  const playDurationMs = current.item.endsAt - current.evaluatedAt;
  if (
    !Number.isSafeInteger(current.evaluatedAt) ||
    !Number.isSafeInteger(current.item.endsAt) ||
    !Number.isSafeInteger(current.mediaOffsetMs) ||
    current.mediaOffsetMs < 0 ||
    !Number.isSafeInteger(playDurationMs) ||
    playDurationMs <= 0
  ) {
    throw invalidItem(channelId, "invalid_current_timing");
  }

  return {
    channelId,
    scheduleEntryId: current.item.scheduleEntryId,
    mediaItemId: current.item.mediaItemId,
    mediaPath: current.item.mediaPath,
    mediaOffsetMs: current.mediaOffsetMs,
    playDurationMs,
  };
}

/**
 * Accepts only the channel's item that begins exactly at the airing boundary;
 * anything else is stale selection because the worker must never guess.
 */
export function selectContiguousFollowing(
  result: FollowingPlayoutResult,
  channelId: ChannelId,
  boundaryAt: TimestampMs,
): SelectedPlayoutItem | undefined {
  if (result.status !== "selected" || result.channelId !== channelId) {
    return undefined;
  }
  const item = result.items[0];
  if (
    item === undefined ||
    item.channelId !== channelId ||
    item.scheduleRevision !== result.scheduleRevision ||
    item.startsAt !== boundaryAt ||
    !Number.isSafeInteger(item.endsAt) ||
    item.endsAt <= item.startsAt ||
    !Number.isSafeInteger(item.startOffsetMs) ||
    item.startOffsetMs < 0
  ) {
    return undefined;
  }
  return item;
}

/** Plays a following item from its selected offset for its scheduled airtime. */
export function toFollowingSignalItem(
  item: SelectedPlayoutItem,
): SignalPlayoutItem {
  return {
    channelId: item.channelId,
    scheduleEntryId: item.scheduleEntryId,
    mediaItemId: item.mediaItemId,
    mediaPath: item.mediaPath,
    mediaOffsetMs: item.startOffsetMs,
    playDurationMs: item.endsAt - item.startsAt,
  };
}

/** Creates a safe invalid-projection error without exposing a media path. */
function invalidItem(channelId: ChannelId, reason: string): SignalError {
  return new SignalError(
    "invalid_playout_item",
    `Channel ${channelId} returned an invalid current playout item`,
    { channelId, reason },
  );
}

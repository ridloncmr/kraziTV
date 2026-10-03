import type {
  ChannelState,
  FollowingPlayout,
  PlayoutItem,
} from "@krazitv/krazi-brain";
import {
  SignalError,
  type CurrentPlayoutResult,
  type FollowingPlayoutResult,
  type SelectedPlayoutItem,
} from "@krazitv/signal";

import type { PlayoutFailure } from "../../playout/contracts.js";

/** Carries kraziBrain's channel state onto the signal port unchanged in meaning. */
export function toCurrentPlayoutResult(
  state: ChannelState,
): CurrentPlayoutResult {
  const base = {
    channelId: state.channelId,
    scheduleRevision: state.scheduleRevision,
    evaluatedAt: state.evaluatedAt,
  };
  if (state.kind === "current") {
    return {
      ...base,
      status: "current",
      mediaOffsetMs: state.currentItem.offsetMs,
      item: toSelectedPlayoutItem(state.currentItem),
    };
  }
  return state.reason === "media_unavailable"
    ? {
        ...base,
        status: "no_current",
        reason: state.reason,
        scheduleEntryId: state.scheduleEntryId,
      }
    : { ...base, status: "no_current", reason: state.reason };
}

/** Carries a following selection onto the signal port with the same status. */
export function toFollowingPlayoutResult(
  following: FollowingPlayout,
): FollowingPlayoutResult {
  const base = {
    channelId: following.channelId,
    scheduleRevision: following.scheduleRevision,
  };
  return following.status === "selected"
    ? {
        ...base,
        status: "selected",
        items: following.items.map(toSelectedPlayoutItem),
      }
    : { ...base, status: "stale_entry", items: [] };
}

/**
 * Turns a playout failure into the error a worker acts on. `unavailable` is
 * transient, so the worker fails and the next tune retries.
 */
export function playoutFailureError(
  failure: PlayoutFailure,
  channelId: string,
): Error {
  switch (failure.kind) {
    case "not_found":
      return new SignalError(
        "channel_not_found",
        `Channel ${channelId} was not found`,
        { channelId },
      );
    case "disabled":
      return new SignalError(
        "channel_disabled",
        `Channel ${channelId} is disabled`,
        { channelId },
      );
    case "unavailable":
      return new SignalError(
        "playout_unavailable",
        `Playout for channel ${channelId} is temporarily unavailable`,
        { channelId },
      );
    case "through_out_of_range":
      // Signal ports never ask past now, so this is a programming error.
      return new Error(
        `Playout read for channel ${channelId} asked past the request limit`,
      );
  }
}

/** Keeps only the fields the signal port carries, dropping record timestamps. */
function toSelectedPlayoutItem(item: PlayoutItem): SelectedPlayoutItem {
  return {
    channelId: item.channelId,
    scheduleEntryId: item.scheduleEntryId,
    scheduleRevision: item.scheduleRevision,
    mediaItemId: item.mediaItemId,
    mediaPath: item.mediaPath,
    hasAudio: item.hasAudio,
    title: item.title,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    durationMs: item.durationMs,
    startOffsetMs: item.startOffsetMs,
  };
}

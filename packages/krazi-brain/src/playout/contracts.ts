import type { ScheduleMediaStatus } from "../schedule/contracts.js";

/** The catalog facts about one entry's media that playout needs, as stored. */
export interface PlayoutMedia {
  path: string;
  status: ScheduleMediaStatus;
  durationMs: number | null;
  hasAudio: boolean | null;
  /** Null for media cataloged before video detection; treated as video. */
  hasVideo: boolean | null;
}

/** One persisted schedule entry with its media, read in one snapshot. */
export interface PlayoutEntry {
  id: string;
  mediaItemId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  createdAt: number;
  updatedAt: number;
  media: PlayoutMedia;
}

/** A reservation's half-open range: all filler derivation knows of it. */
export interface ReservedTimeRange {
  startsAt: number;
  endsAt: number;
}

/**
 * Where a channel stream worker continues from (ADR 0014): a program by its
 * schedule entry, or planned filler by its end, which stays fixed while it
 * airs even if purge moves its start.
 */
export type PlayoutCursor =
  | { kind: "program"; scheduleEntryId: string }
  | { kind: "filler"; endsAt: number };

/** One program a channel transmits, derived from one schedule entry. */
export interface ProgramPlayoutItem {
  type: "program";
  channelId: string;
  scheduleRevision: number;
  /** The source entry's ID: the item's identity and program cursor. */
  scheduleEntryId: string;
  mediaItemId: string;
  /** Internal packaging input; public responses omit it. */
  mediaPath: string;
  /** Internal packaging input; public responses omit it. */
  hasAudio: boolean;
  /** Internal packaging input: false means packaging renders black video. */
  hasVideo: boolean;
  title: string;
  startsAt: number;
  endsAt: number;
  /** The media's playable length, which can differ from its airtime. */
  durationMs: number;
  startOffsetMs: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Planned filler (ADR 0014): non-guide transmission covering time a
 * reservation explains. Its end is when guide-visible programming resumes.
 */
export interface FillerPlayoutItem {
  type: "filler";
  channelId: string;
  scheduleRevision: number;
  startsAt: number;
  endsAt: number;
}

/** One thing on a channel's playout timeline: a program or planned filler. */
export type PlayoutItem = ProgramPlayoutItem | FillerPlayoutItem;

interface FollowingPlayoutBase {
  channelId: string;
  scheduleRevision: number;
}

/**
 * The contiguous playable items after a cursor, possibly none, or
 * `stale_entry` when regeneration deleted the cursor's entry or filler.
 */
export type FollowingPlayout =
  | (FollowingPlayoutBase & {
      status: "selected";
      items: readonly PlayoutItem[];
    })
  | (FollowingPlayoutBase & {
      status: "stale_entry";
      items: readonly [];
    });

/** The current playout item with the join offset for a viewer tuning now. */
type CurrentPlayoutItem = PlayoutItem & { offsetMs: number };

interface ChannelStateBase {
  channelId: string;
  scheduleRevision: number;
  evaluatedAt: number;
}

/** What a channel is transmitting at one instant, or why it transmits nothing. */
export type ChannelState =
  | (ChannelStateBase & {
      kind: "current";
      currentItem: CurrentPlayoutItem;
      nextItem: PlayoutItem | null;
    })
  | (ChannelStateBase & {
      kind: "no_current";
      currentItem: null;
      nextItem: null;
      reason: "schedule_gap";
    })
  | (ChannelStateBase & {
      kind: "no_current";
      currentItem: null;
      nextItem: null;
      reason: "media_unavailable";
      /** The covering entry whose media cannot be transmitted. */
      scheduleEntryId: string;
    });

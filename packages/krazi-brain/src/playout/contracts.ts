import type { ScheduleMediaStatus } from "../schedule/contracts.js";

/** The catalog facts about one entry's media that playout needs, as stored. */
export interface PlayoutMedia {
  path: string;
  status: ScheduleMediaStatus;
  durationMs: number | null;
  hasAudio: boolean | null;
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

/** One thing a channel transmits, derived from one schedule entry. */
export interface PlayoutItem {
  type: "program";
  channelId: string;
  scheduleRevision: number;
  /** The source entry's ID: the item's MVP identity and playout cursor. */
  scheduleEntryId: string;
  mediaItemId: string;
  /** Internal packaging input; public responses omit it. */
  mediaPath: string;
  /** Internal packaging input; public responses omit it. */
  hasAudio: boolean;
  title: string;
  startsAt: number;
  endsAt: number;
  /** The media's playable length, which can differ from its airtime. */
  durationMs: number;
  startOffsetMs: number;
  createdAt: number;
  updatedAt: number;
}

/** The current playout item with the join offset for a viewer tuning now. */
interface CurrentPlayoutItem extends PlayoutItem {
  offsetMs: number;
}

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

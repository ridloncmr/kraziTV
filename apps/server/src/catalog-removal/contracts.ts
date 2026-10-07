/**
 * What a catalog removal takes out of the catalog: one media root with every
 * item under it, or one or more unique items.
 */
export type CatalogRemovalTarget =
  { mediaRootId: string } | { mediaItemIds: readonly string[] };

/** One removal as the API receives it, after validation. */
export interface CatalogRemovalRequest {
  target: CatalogRemovalTarget;
  /** What happens to an entry airing removed media. */
  airing: "finish" | "interrupt";
  /** Remove even when enabled channels are left with nothing to schedule. */
  allowUnschedulable: boolean;
}

/** An enabled channel whose airing entry plays removed media. */
export interface AiringRemovedMedia {
  channelId: string;
  channelNumber: string;
  mediaItemId: string;
  title: string;
  endsAt: number;
}

/** An enabled channel the removal leaves without schedulable media. */
export interface ChannelLeftUnschedulable {
  channelId: string;
  channelNumber: string;
}

/** What a removal would do, computed by the same read the removal runs. */
export interface CatalogRemovalImpact {
  itemCount: number;
  /** In channel ID order. */
  airing: AiringRemovedMedia[];
  /** In channel ID order. */
  channelsLeftUnschedulable: ChannelLeftUnschedulable[];
  /** Channels whose schedules the removal regenerates, in ID order. */
  affectedChannelIds: string[];
}

/** Why a removal was refused, in the order the checks run. */
export type CatalogRemovalRefusal =
  | { kind: "media_root_not_found"; mediaRootId: string }
  | { kind: "unknown_media_items"; mediaItemIds: string[] }
  | { kind: "scan_in_progress" }
  /** Programming blocks play these items directly. */
  | { kind: "media_item_in_use"; channelIds: string[]; mediaItemIds: string[] }
  /** Removal only: the request did not consent to taking channels off the air. */
  | { kind: "channels_left_unschedulable"; impact: CatalogRemovalImpact };

/** The impact read's answer: what a removal would do, or why it is refused. */
export type ImpactRead =
  { kind: "impact"; impact: CatalogRemovalImpact } | CatalogRemovalRefusal;

/**
 * What a committed removal did to the catalog and schedules. Stopping the
 * interrupted channels' workers happens after the commit, outside it.
 */
export interface CatalogRemoval {
  removedItemCount: number;
  /** Channels still airing removed media, with the time each program ends. */
  finishing: { channelId: string; endsAt: number }[];
  /** In channel ID order. */
  interruptedChannelIds: string[];
  affectedChannelIds: string[];
}

/**
 * Whether a new root may take a path a removed root still holds: there was
 * no removed root, purge just freed the path, or an airing entry still holds
 * one of the old root's items until `airingUntil`.
 */
export type RemovedPathReclaim =
  | { kind: "not_removed" }
  | { kind: "reclaimed" }
  | { kind: "removal_pending"; airingUntil: number };

export type CatalogRemovalOutcome =
  { kind: "removed"; removal: CatalogRemoval } | CatalogRemovalRefusal;

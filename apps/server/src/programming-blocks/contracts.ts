import type { PlaybackMode } from "@krazitv/krazi-brain";

/** What a block plays: one collection in a playback mode, or one media item on repeat. */
export type ProgrammingBlockSource =
  | {
      kind: "collection";
      mediaCollectionId: string;
      playbackMode: PlaybackMode;
    }
  | { kind: "media_item"; mediaItemId: string };

export interface ProgrammingBlock {
  id: string;
  channelId: string;
  source: ProgrammingBlockSource;
  createdAt: number;
  updatedAt: number;
}

/** A source naming a collection or item the catalog does not hold. */
export type UnknownSourceResult =
  | { kind: "unknown_collection"; mediaCollectionId: string }
  | { kind: "unknown_media_item"; mediaItemId: string };

export type CreateProgrammingBlockResult =
  | { kind: "created"; block: ProgrammingBlock }
  | { kind: "limit_reached" }
  | { kind: "channel_not_found" }
  | UnknownSourceResult;

export type ReplaceProgrammingBlockSourceResult =
  | { kind: "replaced"; block: ProgrammingBlock }
  | { kind: "unchanged"; block: ProgrammingBlock }
  | { kind: "not_found" }
  | UnknownSourceResult;

export type DeleteProgrammingBlockResult =
  { kind: "deleted" } | { kind: "not_found" };

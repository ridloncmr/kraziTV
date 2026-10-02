type ProgrammingBlockSourceKind = "collection" | "media_item";

export type PlaybackMode = "chronological" | "random";

/** Exactly one source column set is non-null, as `source_kind` says; a check enforces it. */
export interface ProgrammingBlockTable {
  id: string;
  channel_id: string;
  source_kind: ProgrammingBlockSourceKind;
  media_collection_id: string | null;
  media_item_id: string | null;
  playback_mode: PlaybackMode | null;
  created_at: number;
  updated_at: number;
}

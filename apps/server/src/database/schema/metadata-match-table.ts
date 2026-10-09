import type { SqliteBoolean } from "../columns/sqlite-boolean.js";

/** Where an item's content identification stands; a lookup error keeps `unmatched`. */
type MetadataMatchState = "unmatched" | "ambiguous" | "matched" | "rejected";

/** One media item's match decision and the evidence behind it. */
export interface MetadataMatchTable {
  media_item_id: string;
  state: MetadataMatchState;
  /** 1 for bonus material, which is never looked up or matched. */
  extra: SqliteBoolean;
  /** Why the last lookup failed; null after a lookup that answered. */
  lookup_error: string | null;
  /** When TMDB was last asked about this item; null for an extra. */
  looked_up_at: number | null;
  /** JSON: the path hints and the TMDB query the decision rests on. */
  evidence: string;
  /** The item's probed duration when the match was accepted. */
  matched_duration_ms: number | null;
}

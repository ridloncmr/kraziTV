import type { SqliteBoolean } from "../columns/sqlite-boolean.js";

export type MediaItemStatus = "available" | "missing" | "probe_failed";

export interface MediaItemTable {
  id: string;
  media_root_id: string;
  path: string;
  path_key: string;
  title: string;
  duration_ms: number | null;
  has_audio: SqliteBoolean | null;
  /** Null for items cataloged before video detection. */
  has_video: SqliteBoolean | null;
  status: MediaItemStatus;
  probe_error: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  last_probed_at: number | null;
  /** When a user removed the item from the catalog; null while it is cataloged. */
  removed_at: number | null;
}

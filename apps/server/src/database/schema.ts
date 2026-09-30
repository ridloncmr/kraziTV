import type { ColumnType } from "kysely";

export type SqliteBoolean = ColumnType<number, number, number>;
export type MediaItemStatus = "available" | "missing" | "probe_failed";

export interface MediaRootTable {
  id: string;
  path: string;
  path_key: string;
  enabled: SqliteBoolean;
  created_at: number;
  updated_at: number;
  last_scanned_at: number | null;
}

export interface MediaItemTable {
  id: string;
  media_root_id: string;
  path: string;
  path_key: string;
  title: string;
  duration_ms: number | null;
  has_audio: SqliteBoolean | null;
  status: MediaItemStatus;
  probe_error: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  last_probed_at: number | null;
}

export interface DatabaseSchema {
  media_roots: MediaRootTable;
  media_items: MediaItemTable;
}

import type { SqliteBoolean } from "../columns/sqlite-boolean.js";

export interface MediaRootTable {
  id: string;
  path: string;
  path_key: string;
  enabled: SqliteBoolean;
  created_at: number;
  updated_at: number;
  last_scanned_at: number | null;
  /** When a user removed the root from the catalog; null while it is cataloged. */
  removed_at: number | null;
}

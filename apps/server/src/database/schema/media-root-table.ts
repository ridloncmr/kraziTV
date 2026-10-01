import type { SqliteBoolean } from "../types/sqlite-boolean.js";

export interface MediaRootTable {
  id: string;
  path: string;
  path_key: string;
  enabled: SqliteBoolean;
  created_at: number;
  updated_at: number;
  last_scanned_at: number | null;
}

import type { SqliteBoolean } from "../columns/sqlite-boolean.js";

export interface ChannelTable {
  id: string;
  number: string;
  name: string;
  enabled: SqliteBoolean;
  created_at: number;
  updated_at: number;
}

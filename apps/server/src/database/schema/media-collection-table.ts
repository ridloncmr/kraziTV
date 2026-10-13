import type { Generated } from "kysely";

import type { SqliteBoolean } from "../columns/sqlite-boolean.js";

/**
 * A named, ordered set of media items. An automatic collection keeps its
 * membership from a saved criterion; a manual one changes only when the user
 * edits it. Diagnostics are null until the first maintenance pass, and
 * always null on a manual collection.
 */
export interface MediaCollectionTable {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  /** Defaults to `manual`, so an insert that names no mode keeps today's behavior. */
  maintenance_mode: Generated<"manual" | "automatic">;
  /** JSON criterion an automatic collection matches on; null when manual. */
  criterion: string | null;
  /** When the last maintenance pass finished for this collection. */
  maintained_at: number | null;
  /** Why the last maintenance pass failed; null after one that succeeded. */
  maintenance_error: string | null;
  /** 1 when the last pass kept members whose matching evidence was unavailable. */
  maintenance_incomplete: SqliteBoolean | null;
}

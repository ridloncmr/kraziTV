import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type {
  MediaItemStatus,
  MediaItemTable,
} from "../database/schema/media-item-table.js";

export interface MediaItem {
  id: string;
  mediaRootId: string;
  path: string;
  title: string;
  durationMs: number | null;
  hasAudio: boolean | null;
  status: MediaItemStatus;
  probeError: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastProbedAt: number | null;
}

/** Reads committed catalog items; scans remain the only writer. */
export class MediaItemRepository {
  readonly #db: Kysely<DatabaseSchema>;

  // Needs no clock or ID source because it never writes; CatalogScanWriter owns item rows.
  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  /**
   * Lists every item grouped by root path identity, then item path identity,
   * with ID as a stable tie-breaker so repeated reads return the same order.
   */
  async list(): Promise<MediaItem[]> {
    const rows = await this.#db
      .selectFrom("media_items")
      .innerJoin("media_roots", "media_roots.id", "media_items.media_root_id")
      .selectAll("media_items")
      .orderBy("media_roots.path_key")
      .orderBy("media_items.path_key")
      .orderBy("media_items.id")
      .execute();
    return rows.map(toMediaItem);
  }

  /** Loads one item; returns undefined when the ID is unknown. */
  async findById(id: string): Promise<MediaItem | undefined> {
    const row = await this.#db
      .selectFrom("media_items")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaItem(row);
  }
}

// Keeps SQLite's integer booleans and internal identity key out of callers.
function toMediaItem(row: Selectable<MediaItemTable>): MediaItem {
  return {
    id: row.id,
    mediaRootId: row.media_root_id,
    path: row.path,
    title: row.title,
    durationMs: row.duration_ms,
    hasAudio: row.has_audio === null ? null : row.has_audio === 1,
    status: row.status,
    probeError: row.probe_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    lastProbedAt: row.last_probed_at,
  };
}

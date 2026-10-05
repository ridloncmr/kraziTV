import type { Kysely, Selectable } from "kysely";

import { fromNullableSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import { parameterChunks } from "../database/writes/parameter-chunks.js";
import type { MediaItem } from "./contracts.js";

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

/**
 * Returns requested IDs absent from the catalog, in request order without
 * repeats. Takes the caller's executor so the check commits with the write it
 * guards.
 */
export async function findUnknownMediaItemIds(
  executor: Kysely<DatabaseSchema>,
  mediaItemIds: readonly string[],
): Promise<string[]> {
  const requested = [...new Set(mediaItemIds)];
  const known = new Set<string>();
  for (const chunk of parameterChunks(requested)) {
    const rows = await executor
      .selectFrom("media_items")
      .select("id")
      .where("id", "in", chunk)
      .execute();
    for (const { id } of rows) known.add(id);
  }
  return requested.filter((id) => !known.has(id));
}

// Keeps SQLite's integer booleans and internal identity key out of callers.
function toMediaItem(row: Selectable<MediaItemTable>): MediaItem {
  return {
    id: row.id,
    mediaRootId: row.media_root_id,
    path: row.path,
    title: row.title,
    durationMs: row.duration_ms,
    hasAudio: fromNullableSqliteBoolean(row.has_audio),
    hasVideo: fromNullableSqliteBoolean(row.has_video),
    status: row.status,
    probeError: row.probe_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    lastProbedAt: row.last_probed_at,
  };
}

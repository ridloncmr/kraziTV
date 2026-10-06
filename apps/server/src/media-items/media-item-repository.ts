import { sql, type Kysely, type Selectable } from "kysely";

import { fromNullableSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import { parameterChunks } from "../database/writes/parameter-chunks.js";
import type { MediaItem, MediaItemPage, MediaItemQuery } from "./contracts.js";

/** Reads committed catalog items; scans remain the only writer. */
export class MediaItemRepository {
  readonly #db: Kysely<DatabaseSchema>;

  // Needs no clock or ID source because it never writes; CatalogScanWriter owns item rows.
  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  /**
   * Lists one page of items grouped by root path identity, then item path
   * identity, with ID as a stable tie-breaker so offsets address the same rows
   * on repeated reads. `total` counts every match, so callers can page without
   * loading the catalog.
   */
  async list(query: MediaItemQuery): Promise<MediaItemPage> {
    const matching = this.#db
      .selectFrom("media_items")
      .innerJoin("media_roots", "media_roots.id", "media_items.media_root_id")
      .$if(query.search !== "", (builder) =>
        builder.where(matchesSearch(query.search)),
      );
    const rows = await matching
      .selectAll("media_items")
      .orderBy("media_roots.path_key")
      .orderBy("media_items.path_key")
      .orderBy("media_items.id")
      .limit(query.limit)
      .offset(query.offset)
      .execute();
    const { total } = await matching
      .select((eb) => eb.fn.countAll<number>().as("total"))
      .executeTakeFirstOrThrow();
    return { items: rows.map(toMediaItem), total };
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

// Matches a title or path containing the search text. Both sides fold through
// SQLite's lower(), which folds ASCII only, so the comparison stays consistent
// for non-ASCII text; instr() avoids escaping LIKE wildcards in user input.
function matchesSearch(search: string) {
  return sql<boolean>`(instr(lower(media_items.title), lower(${search})) > 0 or instr(lower(media_items.path), lower(${search})) > 0)`;
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

import { sql, type Kysely, type Selectable } from "kysely";

import { fromNullableSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import {
  jsonIdList,
  parameterChunks,
} from "../database/writes/parameter-chunks.js";
import type { MediaItem, MediaItemPage, MediaItemQuery } from "./contracts.js";
import {
  effectiveMetadata,
  METADATA_COLUMNS,
  type MetadataColumns,
} from "./effective-metadata.js";

/**
 * Reads cataloged items. Items a user removed are invisible to every read
 * here; scans and catalog removal write item rows elsewhere.
 */
export class MediaItemRepository {
  readonly #db: Kysely<DatabaseSchema>;

  // Needs no clock or ID source because it never writes; CatalogScanWriter
  // and catalog removal own item rows.
  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  /**
   * Lists one page of items grouped by root path identity, then item path
   * identity, with ID as a stable tie-breaker so offsets address the same rows
   * on repeated reads. `total` counts every match, so callers can page without
   * loading the catalog. Exclusions bind as one JSON parameter, so any number
   * of IDs stays under SQLite's parameter limit.
   */
  async list(query: MediaItemQuery): Promise<MediaItemPage> {
    const matching = this.#withMetadata()
      .innerJoin("media_roots", "media_roots.id", "media_items.media_root_id")
      .where("media_items.removed_at", "is", null)
      .$if(query.search !== "", (builder) =>
        builder.where(matchesSearch(query.search)),
      )
      .$if((query.excludeIds?.length ?? 0) > 0, (builder) =>
        builder.where(
          "media_items.id",
          "not in",
          jsonIdList(query.excludeIds ?? []),
        ),
      )
      .$if(query.needsChoice === true, (builder) =>
        builder.where("metadata_matches.state", "=", "ambiguous"),
      );
    const rows = await matching
      .selectAll("media_items")
      .select(METADATA_COLUMNS)
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

  /** Loads one item; returns undefined when the ID is unknown or removed. */
  async findById(id: string): Promise<MediaItem | undefined> {
    const row = await this.#withMetadata()
      .selectAll("media_items")
      .select(METADATA_COLUMNS)
      .where("media_items.id", "=", id)
      .where("media_items.removed_at", "is", null)
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaItem(row);
  }

  /**
   * Starts an item read with its metadata rows beside it. Each table holds at
   * most one row per item, so the joins never repeat an item.
   */
  #withMetadata() {
    return this.#db
      .selectFrom("media_items")
      .leftJoin(
        "metadata_matches",
        "metadata_matches.media_item_id",
        "media_items.id",
      )
      .leftJoin(
        "content_facts",
        "content_facts.media_item_id",
        "media_items.id",
      )
      .leftJoin(
        "metadata_provider_refs",
        "metadata_provider_refs.media_item_id",
        "media_items.id",
      );
  }
}

/**
 * Returns requested IDs absent from the catalog, in request order without
 * repeats. A removed item counts as absent, so nothing can reference it
 * again. Takes the caller's executor so the check commits with the write it
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
      .where("removed_at", "is", null)
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
function toMediaItem(
  row: Selectable<MediaItemTable> & MetadataColumns,
): MediaItem {
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
    metadata: effectiveMetadata(row),
  };
}

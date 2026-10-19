import {
  sql,
  type Expression,
  type ExpressionBuilder,
  type Kysely,
  type Selectable,
  type SqlBool,
} from "kysely";

import { fromNullableSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import {
  jsonIdList,
  parameterChunks,
} from "../database/writes/parameter-chunks.js";
import type {
  CatalogFilter,
  MatchStateFilter,
  MediaItem,
  MediaItemPage,
  MediaItemQuery,
  RootMatchCounts,
} from "./contracts.js";
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
    const matching = selectWithMetadata(this.#db)
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
      .where((eb) => eb.and(filterConditions(eb, query.filter ?? {})));
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

  /**
   * Counts each root's cataloged items by match state, for the root list.
   * A root without items is absent. The failed-lookup count uses the
   * retry's own rules, so it is zero exactly when a retry would look up
   * nothing.
   */
  async countMatchesByRoot(): Promise<Map<string, RootMatchCounts>> {
    const rows = await this.#db
      .selectFrom("media_items")
      .leftJoin(
        "metadata_matches",
        "metadata_matches.media_item_id",
        "media_items.id",
      )
      .where("media_items.removed_at", "is", null)
      .select((eb) => [
        "media_items.media_root_id",
        eb.fn.countAll<number>().as("items"),
        eb.fn
          .countAll<number>()
          .filterWhere((f) => hasMatchState(f, "matched"))
          .as("matched"),
        eb.fn
          .countAll<number>()
          .filterWhere((f) => hasMatchState(f, "ambiguous"))
          .as("needsChoice"),
        eb.fn
          .countAll<number>()
          .filterWhere((f) => f.and([isRetryable(f), isFailedLookup(f)]))
          .as("failedLookups"),
      ])
      .groupBy("media_items.media_root_id")
      .execute();
    return new Map(
      rows.map(({ media_root_id, ...counts }) => [media_root_id, counts]),
    );
  }

  /** Loads one item; returns undefined when the ID is unknown or removed. */
  async findById(id: string): Promise<MediaItem | undefined> {
    const row = await selectWithMetadata(this.#db)
      .selectAll("media_items")
      .select(METADATA_COLUMNS)
      .where("media_items.id", "=", id)
      .where("media_items.removed_at", "is", null)
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaItem(row);
  }
}

/**
 * Each tagged item's tag names and tag IDs as JSON arrays in the owner's
 * order, one row per item, for joining beside other per-item rows.
 */
export function itemTags(executor: Kysely<DatabaseSchema>) {
  return executor
    .selectFrom("media_item_tags")
    .innerJoin("tags", "tags.id", "media_item_tags.tag_id")
    .select([
      "media_item_tags.media_item_id",
      sql<string>`json_group_array(tags.name order by media_item_tags.position)`.as(
        "tag_names",
      ),
      sql<string>`json_group_array(tags.id order by media_item_tags.position)`.as(
        "tag_ids",
      ),
    ])
    .groupBy("media_item_tags.media_item_id");
}

/**
 * Starts an item read with its metadata rows beside it, for selecting
 * `METADATA_COLUMNS`. Each table, tags included, holds at most one row per
 * item, so the joins never repeat an item. Takes any executor, so a read
 * inside a transaction sees the facts that transaction writes against.
 */
export function selectWithMetadata(executor: Kysely<DatabaseSchema>) {
  return executor
    .selectFrom("media_items")
    .leftJoin(
      "metadata_matches",
      "metadata_matches.media_item_id",
      "media_items.id",
    )
    .leftJoin("content_facts", "content_facts.media_item_id", "media_items.id")
    .leftJoin(
      "metadata_provider_refs",
      "metadata_provider_refs.media_item_id",
      "media_items.id",
    )
    .leftJoin(
      "metadata_corrections",
      "metadata_corrections.media_item_id",
      "media_items.id",
    )
    .leftJoin(itemTags(executor).as("item_tags"), (join) =>
      join.onRef("item_tags.media_item_id", "=", "media_items.id"),
    );
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

/**
 * True for an item whose last lookup failed: unmatched with a lookup error,
 * never an extra. Reads `metadata_matches` joined to the item, so a
 * failed-lookup retry and each root's count share one rule.
 */
export function isFailedLookup(
  eb: ExpressionBuilder<DatabaseSchema, "metadata_matches">,
) {
  return eb.and([
    eb("metadata_matches.state", "=", "unmatched"),
    eb("metadata_matches.extra", "=", 0),
    eb("metadata_matches.lookup_error", "is not", null),
  ]);
}

/**
 * True for an item a lookup retry may look up: available with a probed
 * duration, and never an extra. Reads `metadata_matches` left-joined, so an
 * item never looked up qualifies.
 */
export function isRetryable(
  eb: ExpressionBuilder<DatabaseSchema, "media_items" | "metadata_matches">,
) {
  return eb.and([
    eb("media_items.status", "=", "available"),
    eb("media_items.duration_ms", "is not", null),
    eb.or([
      eb("metadata_matches.extra", "is", null),
      eb("metadata_matches.extra", "=", 0),
    ]),
  ]);
}

// Whether an item's effective match state is `state`, decided as
// effectiveMetadata decides it: no decision row means never looked up, an
// extra wins over its stored state, and a lookup error tells a failed lookup
// from one TMDB answered without a match.
function hasMatchState(
  eb: ExpressionBuilder<DatabaseSchema, "metadata_matches">,
  state: MatchStateFilter,
): Expression<SqlBool> {
  switch (state) {
    case "not_looked_up":
      return eb("metadata_matches.state", "is", null);
    case "extra":
      return eb("metadata_matches.extra", "=", 1);
    case "lookup_failed":
      return isFailedLookup(eb);
    case "unmatched":
      return eb.and([
        eb("metadata_matches.state", "=", "unmatched"),
        eb("metadata_matches.extra", "=", 0),
        eb("metadata_matches.lookup_error", "is", null),
      ]);
    default:
      return eb.and([
        eb("metadata_matches.state", "=", state),
        eb("metadata_matches.extra", "=", 0),
      ]);
  }
}

// One condition per non-empty filter field, each matching any of its values.
// Series identity follows effectiveContentIdentity: an episode whose series
// the owner corrected to another name belongs to no TMDB series, so these
// filters keep what the same collection criterion matches.
function filterConditions(
  eb: ExpressionBuilder<
    DatabaseSchema,
    | "media_items"
    | "metadata_matches"
    | "content_facts"
    | "metadata_corrections"
  >,
  filter: CatalogFilter,
): Expression<SqlBool>[] {
  const conditions: Expression<SqlBool>[] = [];
  const {
    matchStates = [],
    contentTypes = [],
    statuses = [],
    mediaRootIds = [],
    seriesTmdbIds = [],
    franchiseTmdbIds = [],
    genres = [],
    tagIds = [],
  } = filter;
  if (matchStates.length > 0) {
    conditions.push(
      eb.or(matchStates.map((state) => hasMatchState(eb, state))),
    );
  }
  if (contentTypes.length > 0) {
    conditions.push(eb("content_facts.content_type", "in", contentTypes));
  }
  if (statuses.length > 0) {
    conditions.push(eb("media_items.status", "in", statuses));
  }
  if (mediaRootIds.length > 0) {
    conditions.push(eb("media_items.media_root_id", "in", mediaRootIds));
  }
  if (seriesTmdbIds.length > 0) {
    conditions.push(
      eb.and([
        eb("content_facts.series_tmdb_id", "in", seriesTmdbIds),
        eb.or([
          eb("metadata_corrections.series_name", "is", null),
          eb("content_facts.series_name", "is", null),
          eb(
            "metadata_corrections.series_name",
            "=",
            eb.ref("content_facts.series_name"),
          ),
        ]),
      ]),
    );
  }
  if (franchiseTmdbIds.length > 0) {
    conditions.push(
      eb("content_facts.franchise_tmdb_id", "in", franchiseTmdbIds),
    );
  }
  if (genres.length > 0) {
    conditions.push(
      sql<SqlBool>`exists (select 1 from json_each(content_facts.genres) where json_each.value in (${sql.join(genres)}))`,
    );
  }
  if (tagIds.length > 0) {
    conditions.push(
      eb.exists(
        eb
          .selectFrom("media_item_tags")
          .select("media_item_tags.media_item_id")
          .whereRef("media_item_tags.media_item_id", "=", "media_items.id")
          .where("media_item_tags.tag_id", "in", tagIds),
      ),
    );
  }
  return conditions;
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

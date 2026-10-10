import { dirname, sep } from "node:path";

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { RetryItem, RetryScope } from "../contracts.js";
import { isSettledMatch } from "./settled-match.js";

/** Reads metadata match decisions for catalog scans and lookup retries. */
export class MetadataMatchRepository {
  readonly #db: Kysely<DatabaseSchema>;

  // Shares the server's one database handle.
  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  /**
   * Returns the path keys under a root whose match decision or corrections
   * settle it, so a rescan of a matched library makes almost no TMDB calls.
   * A removed item never counts, since rediscovery treats it as new.
   */
  async findSettledPathKeys(rootId: string): Promise<Set<string>> {
    const rows = await this.#db
      .selectFrom("media_items")
      .leftJoin(
        "metadata_matches",
        "metadata_matches.media_item_id",
        "media_items.id",
      )
      .select("media_items.path_key")
      .where("media_items.media_root_id", "=", rootId)
      // A removed item a scan rediscovers starts afresh (spec 0010).
      .where("media_items.removed_at", "is", null)
      .where(isSettledMatch)
      .execute();
    return new Set(rows.map((row) => row.path_key));
  }

  /**
   * Reads the items a lookup retry covers, in path order, each with the
   * decision it holds now so the retry's commit can tell whether it changed
   * meanwhile. Whatever the decision, every available item with a probed
   * duration is covered, except an extra, which a retry never changes.
   * Undefined when the scope's item is unknown or removed; a failed-lookup
   * scope names its root, which the scanner checks.
   */
  async findRetryItems(
    scope: RetryScope,
  ): Promise<{ rootId: string; items: RetryItem[] } | undefined> {
    const anchor =
      scope.scope === "failed"
        ? { media_root_id: scope.mediaRootId, path_key: "" }
        : await this.#db
            .selectFrom("media_items")
            .select(["media_root_id", "path_key"])
            .where("id", "=", scope.mediaItemId)
            .where("removed_at", "is", null)
            .executeTakeFirst();
    if (anchor === undefined) return undefined;
    const rows = await this.#db
      .selectFrom("media_items")
      .leftJoin(
        "metadata_matches",
        "metadata_matches.media_item_id",
        "media_items.id",
      )
      .select([
        "media_items.id",
        "media_items.path",
        "media_items.path_key",
        "media_items.duration_ms",
        "metadata_matches.state",
        "metadata_matches.looked_up_at",
      ])
      .where("media_items.media_root_id", "=", anchor.media_root_id)
      .where("media_items.removed_at", "is", null)
      .where("media_items.status", "=", "available")
      .where("media_items.duration_ms", "is not", null)
      .where((eb) =>
        eb.or([
          eb("metadata_matches.extra", "is", null),
          eb("metadata_matches.extra", "=", 0),
        ]),
      )
      .$if(scope.scope === "failed", (query) =>
        query
          .where("metadata_matches.state", "=", "unmatched")
          .where("metadata_matches.lookup_error", "is not", null),
      )
      .$narrowType<{ duration_ms: number }>()
      .orderBy("media_items.path_key")
      .execute();
    // Path keys are native and normalized, so a folder is a key prefix.
    const folder = `${dirname(anchor.path_key)}${sep}`;
    return {
      rootId: anchor.media_root_id,
      items: rows
        .filter((row) =>
          scope.scope === "item"
            ? row.id === scope.mediaItemId
            : scope.scope === "failed" || row.path_key.startsWith(folder),
        )
        .map((row) => ({
          id: row.id,
          path: row.path,
          pathKey: row.path_key,
          durationMs: row.duration_ms,
          read:
            row.state === null
              ? null
              : { state: row.state, lookedUpAt: row.looked_up_at },
        })),
    };
  }
}

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { isSettledMatch } from "./settled-match.js";

/** Reads metadata match decisions for the catalog scan. */
export class MetadataMatchRepository {
  readonly #db: Kysely<DatabaseSchema>;

  // Shares the server's one database handle.
  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  /**
   * Returns the path keys under a root whose match decision is settled, so
   * a rescan of a matched library makes almost no TMDB calls. A removed
   * item's decision never counts, since rediscovery treats it as new.
   */
  async findSettledPathKeys(rootId: string): Promise<Set<string>> {
    const rows = await this.#db
      .selectFrom("metadata_matches")
      .innerJoin(
        "media_items",
        "media_items.id",
        "metadata_matches.media_item_id",
      )
      .select("media_items.path_key")
      .where("media_items.media_root_id", "=", rootId)
      // A removed item a scan rediscovers starts afresh (spec 0010).
      .where("media_items.removed_at", "is", null)
      .where(isSettledMatch)
      .execute();
    return new Set(rows.map((row) => row.path_key));
  }
}

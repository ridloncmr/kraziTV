import type { Kysely } from "kysely";

import type { CollectionMaintenance } from "../../media-collections/maintenance/collection-maintenance.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type { CorrectionChange } from "../contracts.js";
import { recordMatchedDuration } from "../persistence/matched-duration.js";
import { storeCorrection } from "./store-correction.js";

/**
 * Stores the owner's corrections and tags. They live in their own table, so
 * scans, retries, refreshes, and match choices, which replace an item's match
 * rows, never touch them; effective metadata puts them ahead of provider
 * facts. Needs no TMDB key, since without one corrections are the only way
 * to set facts.
 */
export class CorrectionService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #collections: Pick<CollectionMaintenance, "request">;

  // Shares the server's one database handle; corrections change the facts
  // automatic collections match on, so each one asks for maintenance.
  constructor(
    db: Kysely<DatabaseSchema>,
    collections: Pick<CollectionMaintenance, "request">,
  ) {
    this.#db = db;
    this.#collections = collections;
  }

  /**
   * Applies one change to a cataloged item's corrections. The merge reads the
   * stored row under write authority, so two changes to different fields both
   * land, and a removed item is refused rather than given corrections. Saving
   * counts as the owner reviewing the file, so a matched item takes its
   * current duration as its match-time duration.
   */
  async correct(
    mediaItemId: string,
    change: CorrectionChange,
  ): Promise<"corrected" | "item_not_found"> {
    const result = await runImmediateTransaction(this.#db, async (pinned) => {
      const unknown = await findUnknownMediaItemIds(pinned, [mediaItemId]);
      if (unknown.length > 0) return "item_not_found" as const;
      await storeCorrection(pinned, mediaItemId, change);
      await recordMatchedDuration(pinned, mediaItemId);
      return "corrected" as const;
    });
    if (result === "corrected") void this.#collections.request();
    return result;
  }
}

import type { Kysely } from "kysely";

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

  // Shares the server's one database handle.
  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
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
    return runImmediateTransaction(this.#db, async (pinned) => {
      const unknown = await findUnknownMediaItemIds(pinned, [mediaItemId]);
      if (unknown.length > 0) return "item_not_found";
      await storeCorrection(pinned, mediaItemId, change);
      await recordMatchedDuration(pinned, mediaItemId);
      return "corrected";
    });
  }
}

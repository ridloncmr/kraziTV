import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MetadataCorrectionTable } from "../../database/schema/metadata-correction-table.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type { CorrectionChange } from "../contracts.js";
import { CORRECTED_COLUMNS } from "../persistence/corrected-columns.js";
import { recordMatchedDuration } from "../persistence/matched-duration.js";

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
   * land, and a removed item is refused rather than given corrections. A row
   * left with nothing corrected and no tags is deleted. Saving counts as the
   * owner reviewing the file, so a matched item takes its current duration
   * as its match-time duration.
   */
  async correct(
    mediaItemId: string,
    change: CorrectionChange,
  ): Promise<"corrected" | "item_not_found"> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const unknown = await findUnknownMediaItemIds(pinned, [mediaItemId]);
      if (unknown.length > 0) return "item_not_found";
      const stored = await pinned
        .selectFrom("metadata_corrections")
        .selectAll()
        .where("media_item_id", "=", mediaItemId)
        .executeTakeFirst();
      const next = merged(mediaItemId, stored, change);
      await pinned
        .deleteFrom("metadata_corrections")
        .where("media_item_id", "=", mediaItemId)
        .execute();
      if (!isEmpty(next)) {
        await pinned.insertInto("metadata_corrections").values(next).execute();
      }
      await recordMatchedDuration(pinned, mediaItemId);
      return "corrected";
    });
  }
}

// The row after `change`: each given field replaces the stored one, and each
// absent field keeps it.
function merged(
  mediaItemId: string,
  stored: Selectable<MetadataCorrectionTable> | undefined,
  change: CorrectionChange,
): Selectable<MetadataCorrectionTable> {
  return {
    media_item_id: mediaItemId,
    title: kept(change.title, stored?.title),
    series_name: kept(change.seriesName, stored?.series_name),
    season_number: kept(change.seasonNumber, stored?.season_number),
    episode_number: kept(change.episodeNumber, stored?.episode_number),
    tags:
      change.tags !== undefined
        ? JSON.stringify(change.tags)
        : (stored?.tags ?? "[]"),
  };
}

// A field's value after a change: the given value, null included, or else
// the stored one.
function kept<T>(given: T | null | undefined, stored: T | null | undefined) {
  return given !== undefined ? given : (stored ?? null);
}

// True when a row corrects nothing and holds no tags, so it need not exist.
function isEmpty(row: Selectable<MetadataCorrectionTable>): boolean {
  return (
    CORRECTED_COLUMNS.every((column) => row[column] === null) &&
    row.tags === "[]"
  );
}

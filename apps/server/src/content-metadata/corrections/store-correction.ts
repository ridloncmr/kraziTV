import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MetadataCorrectionTable } from "../../database/schema/metadata-correction-table.js";
import type { CorrectionChange } from "../contracts.js";
import { CORRECTED_COLUMNS } from "../persistence/corrected-columns.js";
import { replaceItemTags } from "./item-tags.js";

/**
 * Merges one change into an item's stored corrections inside the caller's
 * transaction, which must hold write authority and have checked the item is
 * cataloged. Each given field replaces the stored one and each absent field
 * keeps it; a row left correcting nothing is deleted. Given tags replace the
 * item's tags. The correction route and track mapping both store
 * corrections this way.
 */
export async function storeCorrection(
  executor: Kysely<DatabaseSchema>,
  mediaItemId: string,
  change: CorrectionChange,
): Promise<void> {
  const stored = await executor
    .selectFrom("metadata_corrections")
    .selectAll()
    .where("media_item_id", "=", mediaItemId)
    .executeTakeFirst();
  const next = merged(mediaItemId, stored, change);
  await executor
    .deleteFrom("metadata_corrections")
    .where("media_item_id", "=", mediaItemId)
    .execute();
  if (!isEmpty(next)) {
    await executor.insertInto("metadata_corrections").values(next).execute();
  }
  if (change.tags !== undefined) {
    await replaceItemTags(executor, mediaItemId, change.tags);
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
  };
}

// A field's value after a change: the given value, null included, or else
// the stored one.
function kept<T>(given: T | null | undefined, stored: T | null | undefined) {
  return given !== undefined ? given : (stored ?? null);
}

// True when a row corrects nothing, so it need not exist.
function isEmpty(row: Selectable<MetadataCorrectionTable>): boolean {
  return CORRECTED_COLUMNS.every((column) => row[column] === null);
}

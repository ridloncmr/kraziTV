import type { Transaction } from "kysely";

import type { MetadataMatchRecord } from "../../content-metadata/contracts.js";
import {
  deleteMatchRows,
  replaceMatchRows,
} from "../../content-metadata/persistence/match-rows.js";
import { isSettledMatch } from "../../content-metadata/persistence/settled-match.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { jsonIdList } from "../../database/writes/parameter-chunks.js";

/**
 * Writes each record's metadata rows inside the scan's commit. A removed item
 * the scan rediscovered returns as newly discovered (spec 0010), so its old
 * decision and corrections are cleared first. Otherwise only an unsettled
 * item takes a record: the scan read settled items before its lookups, so
 * this re-check inside the transaction keeps a choice, match, or correction
 * made meanwhile from being overwritten.
 */
export async function writeMetadataMatches(
  trx: Transaction<DatabaseSchema>,
  itemIds: ReadonlyMap<string, string>,
  records: readonly MetadataMatchRecord[],
  rediscoveredIds: readonly string[],
): Promise<void> {
  await deleteMatchRows(trx, rediscoveredIds);
  if (rediscoveredIds.length > 0) {
    await trx
      .deleteFrom("metadata_corrections")
      .where("media_item_id", "in", jsonIdList(rediscoveredIds))
      .execute();
  }
  const staged = records.flatMap((record) => {
    const id = itemIds.get(record.pathKey);
    return id === undefined ? [] : [{ id, record }];
  });
  if (staged.length === 0) return;

  const settled = new Set(
    (
      await trx
        .selectFrom("media_items")
        .leftJoin(
          "metadata_matches",
          "metadata_matches.media_item_id",
          "media_items.id",
        )
        .select("media_items.id")
        .where("media_items.id", "in", jsonIdList(staged.map(({ id }) => id)))
        .where(isSettledMatch)
        .execute()
    ).map((row) => row.id),
  );
  await replaceMatchRows(
    trx,
    staged.filter(({ id }) => !settled.has(id)),
  );
}

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
 * decision is cleared first. Otherwise only an item with no decision, or an
 * unmatched non-extra one, takes a record: the scan read match states before
 * its lookups, so this re-check inside the transaction keeps a choice or
 * match made meanwhile from being overwritten.
 */
export async function writeMetadataMatches(
  trx: Transaction<DatabaseSchema>,
  itemIds: ReadonlyMap<string, string>,
  records: readonly MetadataMatchRecord[],
  rediscoveredIds: readonly string[],
): Promise<void> {
  await deleteMatchRows(trx, rediscoveredIds);
  const staged = records.flatMap((record) => {
    const id = itemIds.get(record.pathKey);
    return id === undefined ? [] : [{ id, record }];
  });
  if (staged.length === 0) return;

  const settled = new Set(
    (
      await trx
        .selectFrom("metadata_matches")
        .select("media_item_id")
        .where("media_item_id", "in", jsonIdList(staged.map(({ id }) => id)))
        .where(isSettledMatch)
        .execute()
    ).map((row) => row.media_item_id),
  );
  await replaceMatchRows(
    trx,
    staged.filter(({ id }) => !settled.has(id)),
  );
}

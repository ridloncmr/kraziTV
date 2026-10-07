import { sql, type RawBuilder } from "kysely";

import { jsonIdList } from "../database/writes/parameter-chunks.js";
import type { CatalogRemovalTarget } from "./contracts.js";

/**
 * Selects the ID of every item a removal target covers, as a parenthesized
 * subquery any statement can test membership against: a root's items by its
 * key, or listed IDs bound as one JSON parameter. Either way a removal costs
 * the same number of statements however many items it covers, and never
 * meets SQLite's parameter limit.
 */
export function targetItemIds(
  target: CatalogRemovalTarget,
): RawBuilder<string> {
  return "mediaRootId" in target
    ? sql<string>`(select id from media_items where media_root_id = ${target.mediaRootId})`
    : jsonIdList(target.mediaItemIds);
}

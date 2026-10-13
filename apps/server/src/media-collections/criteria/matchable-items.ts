import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  effectiveContentIdentity,
  effectiveMetadata,
  METADATA_COLUMNS,
} from "../../media-items/effective-metadata.js";
import { selectWithMetadata } from "../../media-items/media-item-repository.js";
import type { MatchableItem } from "../contracts.js";

/**
 * Reads every cataloged item's effective facts through the same join and
 * precedence rules as the Media Library, so a criterion never sees a fact
 * the owner does not. Removed items are left out, since removal takes an
 * item out of every collection; missing ones stay. Takes any executor, so
 * a pass reads the facts its own transaction writes against.
 */
export async function readMatchableItems(
  executor: Kysely<DatabaseSchema>,
): Promise<MatchableItem[]> {
  const rows = await selectWithMetadata(executor)
    .select([
      "media_items.id",
      "media_items.title as item_title",
      "media_items.path",
      "media_items.status",
      "media_items.duration_ms",
    ])
    .select(METADATA_COLUMNS)
    .where("media_items.removed_at", "is", null)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    title: row.item_title,
    path: row.path,
    status: row.status,
    durationMs: row.duration_ms,
    metadata: effectiveMetadata(row),
    identity: effectiveContentIdentity(row),
  }));
}

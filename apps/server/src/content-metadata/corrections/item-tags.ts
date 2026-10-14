import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";

/**
 * The key a tag name resolves by: trimmed and lower-cased, so `Christmas`
 * and `christmas ` are one tag. Every name-to-tag lookup goes through here.
 */
function tagKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Replaces an item's tags with `names`, in that order, inside the caller's
 * transaction, which must hold write authority. Each name resolves to the
 * tag with its key, created with that spelling when none exists, so a tag
 * keeps one identity however items spell it. A name repeated under another
 * case counts once. Tags left with no items stay, so collections keyed by
 * them stay valid.
 */
export async function replaceItemTags(
  executor: Kysely<DatabaseSchema>,
  mediaItemId: string,
  names: readonly string[],
): Promise<void> {
  await executor
    .deleteFrom("media_item_tags")
    .where("media_item_id", "=", mediaItemId)
    .execute();
  const seen = new Set<string>();
  for (const name of names) {
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    await executor
      .insertInto("media_item_tags")
      .values({
        media_item_id: mediaItemId,
        tag_id: await resolveTag(executor, name.trim(), key),
        position: seen.size - 1,
      })
      .execute();
  }
}

// The ID of the tag with `key`, creating it named `name` when none exists.
async function resolveTag(
  executor: Kysely<DatabaseSchema>,
  name: string,
  key: string,
): Promise<string> {
  const existing = await executor
    .selectFrom("tags")
    .select("id")
    .where("name_key", "=", key)
    .executeTakeFirst();
  if (existing !== undefined) return existing.id;
  const id = randomUUID();
  await executor
    .insertInto("tags")
    .values({ id, name, name_key: key })
    .execute();
  return id;
}

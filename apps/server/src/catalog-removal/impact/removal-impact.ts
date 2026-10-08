import { isSchedulableMedia } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import { toSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { findChannelsUsingCollection } from "../../media-collections/channels-using-collection.js";
import type { MediaCollectionMember } from "../../media-collections/contracts.js";
import { selectMembers } from "../../media-collections/media-collection-repository.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type {
  AiringRemovedMedia,
  CatalogRemovalRefusal,
  CatalogRemovalTarget,
  ChannelLeftUnschedulable,
  ImpactRead,
} from "../contracts.js";
import { targetItemIds } from "../removal-target.js";

type Executor = Kysely<DatabaseSchema>;

/** A collection that loses items, with the channels whose block draws from it. */
interface AffectedCollection {
  id: string;
  channelIds: string[];
}

/**
 * Computes what removing `target` at `now` would do, or the first refusal in
 * the API's check order. Only reads, so the preview runs it in a deferred
 * snapshot and the removal in its immediate transaction, and the two can
 * never disagree about the rules. `isScanning` is the scanner's in-memory
 * answer; a scan admitted later is refused by the scan writer's own check.
 */
export async function readRemovalImpact(
  trx: Executor,
  target: CatalogRemovalTarget,
  now: number,
  isScanning: (rootId: string) => boolean,
): Promise<ImpactRead> {
  const missing = await findMissingTarget(trx, target);
  if (missing !== undefined) return missing;
  const items = targetItemIds(target);
  const roots =
    "mediaRootId" in target
      ? [target.mediaRootId]
      : (
          await trx
            .selectFrom("media_items")
            .select("media_root_id")
            .distinct()
            .where("id", "in", items)
            .execute()
        ).map((row) => row.media_root_id);
  if (roots.some(isScanning)) {
    return { kind: "scan_in_progress" };
  }
  const inUse = await trx
    .selectFrom("programming_blocks")
    .select(["channel_id", "media_item_id"])
    .where("source_kind", "=", "media_item")
    .where("media_item_id", "in", items)
    // A single-item block always names its item.
    .$narrowType<{ media_item_id: string }>()
    .execute();
  if (inUse.length > 0) {
    return {
      kind: "media_item_in_use",
      channelIds: sortedUnique(inUse.map((row) => row.channel_id)),
      mediaItemIds: sortedUnique(inUse.map((row) => row.media_item_id)),
    };
  }

  const collections = await findAffectedCollections(trx, target);
  return {
    kind: "impact",
    impact: {
      itemCount: await countRemovedItems(trx, target),
      airing: await findAiringRemovedMedia(trx, target, now),
      channelsLeftUnschedulable: await findChannelsLeftUnschedulable(
        trx,
        target,
        collections,
      ),
      affectedChannelIds: await findAffectedChannels(
        trx,
        target,
        now,
        collections,
      ),
    },
  };
}

/**
 * Refuses a root that is unknown or already removed, or any listed item that
 * is; undefined when the whole target is in the catalog.
 */
async function findMissingTarget(
  trx: Executor,
  target: CatalogRemovalTarget,
): Promise<CatalogRemovalRefusal | undefined> {
  if ("mediaRootId" in target) {
    const root = await trx
      .selectFrom("media_roots")
      .select("id")
      .where("id", "=", target.mediaRootId)
      .where("removed_at", "is", null)
      .executeTakeFirst();
    return root === undefined
      ? { kind: "media_root_not_found", mediaRootId: target.mediaRootId }
      : undefined;
  }
  const unknown = await findUnknownMediaItemIds(trx, target.mediaItemIds);
  return unknown.length > 0
    ? { kind: "unknown_media_items", mediaItemIds: unknown }
    : undefined;
}

// Counts the cataloged items the target covers; a root's earlier removed
// items are already gone from the catalog.
async function countRemovedItems(
  trx: Executor,
  target: CatalogRemovalTarget,
): Promise<number> {
  if ("mediaItemIds" in target) return target.mediaItemIds.length;
  const { count } = await trx
    .selectFrom("media_items")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("media_root_id", "=", target.mediaRootId)
    .where("removed_at", "is", null)
    .executeTakeFirstOrThrow();
  return count;
}

/**
 * Lists enabled channels whose entry airing at `now` plays a removed item.
 * A disabled channel transmits nothing, so nothing of it is on air.
 */
async function findAiringRemovedMedia(
  trx: Executor,
  target: CatalogRemovalTarget,
  now: number,
): Promise<AiringRemovedMedia[]> {
  const rows = await trx
    .selectFrom("schedule_entries")
    .innerJoin("channels", "channels.id", "schedule_entries.channel_id")
    .select([
      "schedule_entries.channel_id",
      "channels.number",
      "schedule_entries.media_item_id",
      "schedule_entries.title",
      "schedule_entries.ends_at",
    ])
    .where("channels.enabled", "=", toSqliteBoolean(true))
    .where("schedule_entries.starts_at", "<=", now)
    .where("schedule_entries.ends_at", ">", now)
    .where("schedule_entries.media_item_id", "in", targetItemIds(target))
    .orderBy("schedule_entries.channel_id")
    .execute();
  return rows.map((row) => ({
    channelId: row.channel_id,
    channelNumber: row.number,
    mediaItemId: row.media_item_id,
    title: row.title,
    endsAt: row.ends_at,
  }));
}

/**
 * Lists each collection that holds a removed item, with the channels drawing
 * from it. Statements grow with the affected collections, never with the
 * item count.
 */
async function findAffectedCollections(
  trx: Executor,
  target: CatalogRemovalTarget,
): Promise<AffectedCollection[]> {
  const rows = await trx
    .selectFrom("media_collection_items")
    .select("media_collection_id")
    .distinct()
    .where("media_item_id", "in", targetItemIds(target))
    .orderBy("media_collection_id")
    .execute();
  const collections: AffectedCollection[] = [];
  for (const { media_collection_id: id } of rows) {
    collections.push({
      id,
      channelIds: await findChannelsUsingCollection(trx, id),
    });
  }
  return collections;
}

/**
 * Lists enabled channels the removal takes off the air: their block draws
 * from a collection that has a schedulable member now and would have none
 * left. A collection that was already unschedulable is not this removal's
 * doing, and a disabled channel is off the air already. kraziBrain decides
 * what is schedulable.
 */
async function findChannelsLeftUnschedulable(
  trx: Executor,
  target: CatalogRemovalTarget,
  collections: readonly AffectedCollection[],
): Promise<ChannelLeftUnschedulable[]> {
  const used = collections.filter(({ channelIds }) => channelIds.length > 0);
  if (used.length === 0) return [];

  const removed = new Set(
    (
      await trx
        .selectFrom("media_items")
        .select("id")
        .where("id", "in", targetItemIds(target))
        .execute()
    ).map((row) => row.id),
  );
  const channelIds: string[] = [];
  for (const { id, channelIds: users } of used) {
    const schedulable = (await selectMembers(trx, id)).filter(isSchedulable);
    const kept = schedulable.filter(
      (member) => !removed.has(member.mediaItemId),
    );
    if (schedulable.length > 0 && kept.length === 0) channelIds.push(...users);
  }
  if (channelIds.length === 0) return [];

  const channels = await trx
    .selectFrom("channels")
    .select(["id", "number"])
    .where("enabled", "=", toSqliteBoolean(true))
    .where("id", "in", channelIds)
    .orderBy("id")
    .execute();
  return channels.map((row) => ({
    channelId: row.id,
    channelNumber: row.number,
  }));
}

/**
 * Names every channel whose schedule the removal changes: each channel whose
 * block draws from a collection that loses items, and each channel with an
 * entry on a removed item that has not ended.
 */
async function findAffectedChannels(
  trx: Executor,
  target: CatalogRemovalTarget,
  now: number,
  collections: readonly AffectedCollection[],
): Promise<string[]> {
  const scheduled = await trx
    .selectFrom("schedule_entries")
    .select("channel_id")
    .distinct()
    .where("ends_at", ">", now)
    .where("media_item_id", "in", targetItemIds(target))
    .execute();
  return sortedUnique([
    ...collections.flatMap(({ channelIds }) => channelIds),
    ...scheduled.map((row) => row.channel_id),
  ]);
}

// Applies kraziBrain's schedulable rule to a collection member.
function isSchedulable(member: MediaCollectionMember): boolean {
  return isSchedulableMedia({ ...member, id: member.mediaItemId });
}

// One stable order for every ID list the API reports.
function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

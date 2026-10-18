import { sql, type Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { deleteEndedReservations } from "../../reservations/persistence/reservation-rows.js";
import { advanceScheduleRevision } from "../../schedules/persistence/schedule-repository.js";

/**
 * Deletes every removed item that no schedule entry holds past `now`,
 * together with its entries, all of which have ended, and then every removed
 * root left without items. Each channel that loses entries advances its
 * schedule revision once, in the caller's transaction, which must hold write
 * authority; a channel in `alreadyAdvanced` was advanced earlier in the same
 * commit and is left alone, since a commit advances a revision only once.
 * Statements grow with the channels that lose entries, never with the
 * number of items.
 */
export async function purgeRemovedMedia(
  trx: Kysely<DatabaseSchema>,
  now: number,
  alreadyAdvanced: ReadonlySet<string> = new Set(),
): Promise<void> {
  const purgeable = sql<string>`(
    select id from media_items
    where removed_at is not null
      and not exists (
        select 1 from schedule_entries
        where schedule_entries.media_item_id = media_items.id
          and schedule_entries.ends_at > ${now}
      )
  )`;
  const channels = await trx
    .selectFrom("schedule_entries")
    .select("channel_id")
    .distinct()
    .where("media_item_id", "in", purgeable)
    .execute();
  await trx
    .deleteFrom("schedule_entries")
    .where("media_item_id", "in", purgeable)
    .execute();
  // Only ended reservations can still list a removed item, since an
  // unended one refuses its removal; they go with it.
  await deleteEndedReservations(trx, { mediaItemIds: purgeable }, now);
  // Purgeable items have no entries left now; held ones still have some.
  await trx
    .deleteFrom("media_items")
    .where("removed_at", "is not", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("schedule_entries")
            .select("schedule_entries.id")
            .whereRef("schedule_entries.media_item_id", "=", "media_items.id"),
        ),
      ),
    )
    .execute();
  await trx
    .deleteFrom("media_roots")
    .where("removed_at", "is not", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("media_items")
            .select("media_items.id")
            .whereRef("media_items.media_root_id", "=", "media_roots.id"),
        ),
      ),
    )
    .execute();

  for (const { channel_id } of channels) {
    if (alreadyAdvanced.has(channel_id)) continue;
    // Only ended entries went, so the planned programming a preview shows
    // is unchanged.
    await advanceScheduleRevision(trx, channel_id, now, {
      programmingChanged: false,
    });
  }
}

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleInputChange } from "./contracts.js";
import {
  findStartedTurn,
  markTurnEnded,
} from "./persistence/generated-blocks.js";

/** Whether startup found a new programming timezone, and which channels it regenerated. */
type TimezoneChangeResult =
  | { kind: "unchanged" }
  | { kind: "changed"; previous: string | null; channelIds: string[] };

/**
 * Records the programming timezone directly when no channel has a rule, so
 * a change that can regenerate nothing never runs a schedule change, and
 * reports whether one is needed: the timezone differs from the recorded one
 * and some channel has a rule.
 */
export async function recordTimezoneUnlessRulesNeedIt(
  trx: Kysely<DatabaseSchema>,
  timeZone: string,
): Promise<boolean> {
  const { programming_timezone: previous } = await trx
    .selectFrom("server_settings")
    .select("programming_timezone")
    .executeTakeFirstOrThrow();
  if (previous === timeZone) return false;
  const ruled = await trx
    .selectFrom("programming_rules")
    .select("id")
    .limit(1)
    .executeTakeFirst();
  if (ruled !== undefined) return true;
  await trx
    .updateTable("server_settings")
    .set({ programming_timezone: timeZone })
    .execute();
  return false;
}

/**
 * The programming timezone as a schedule input change (programming spec
 * 0005), applied once at startup: when it differs from the one schedules
 * were last generated in, every channel with a rule ends its started turn
 * after the airing program and regenerates from there, and the new
 * timezone is recorded in the same transaction, so a later restart under
 * it changes nothing. Channels without rules are not touched, and covered
 * entries are never re-evaluated outside regeneration.
 */
export function programmingTimezoneChange(
  timeZone: string,
): ScheduleInputChange<TimezoneChangeResult> {
  return async (trx, now) => {
    const { programming_timezone: previous } = await trx
      .selectFrom("server_settings")
      .select("programming_timezone")
      .executeTakeFirstOrThrow();
    if (previous === timeZone) {
      return { value: { kind: "unchanged" }, affectedChannelIds: [] };
    }
    const channelIds = (
      await trx
        .selectFrom("programming_rules")
        .select("channel_id")
        .distinct()
        .orderBy("channel_id")
        .execute()
    ).map(({ channel_id }) => channel_id);
    for (const channelId of channelIds) {
      const started = await findStartedTurn(trx, channelId, now);
      if (started !== undefined) await markTurnEnded(trx, started.block.id);
    }
    await trx
      .updateTable("server_settings")
      .set({ programming_timezone: timeZone })
      .execute();
    return {
      value: { kind: "changed", previous, channelIds },
      affectedChannelIds: channelIds,
    };
  };
}

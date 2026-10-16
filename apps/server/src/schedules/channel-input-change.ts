import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleInputChange } from "./contracts.js";

/**
 * Wraps one channel's programming write, such as an assignment or rule
 * edit, as a schedule input change that affects the channel only when the
 * write reports the kind that changed its programming, so a rejected or
 * no-op write regenerates nothing.
 */
export function channelInputChange<T extends { kind: string }>(
  channelId: string,
  changedKind: T["kind"],
  write: (trx: Kysely<DatabaseSchema>, now: number) => Promise<T>,
): ScheduleInputChange<T> {
  return async (trx, now) => {
    const value = await write(trx, now);
    return {
      value,
      affectedChannelIds: value.kind === changedKind ? [channelId] : [],
    };
  };
}

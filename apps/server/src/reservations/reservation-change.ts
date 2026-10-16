import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { channelInputChange } from "../schedules/channel-input-change.js";
import type { ScheduleInputChange } from "../schedules/contracts.js";
import { advanceScheduleRevision } from "../schedules/persistence/schedule-repository.js";

/**
 * Wraps a reservation write as a channel input change that regenerates the
 * channel when the write reports `changedKind`, and advances its schedule
 * revision exactly once in the same commit even when no entry changed,
 * because a reservation also decides planned filler (ADR 0014).
 */
export function reservationChange<T extends { kind: string }>(
  channelId: string,
  changedKind: T["kind"],
  write: (trx: Kysely<DatabaseSchema>, now: number) => Promise<T>,
): ScheduleInputChange<T> {
  const change = channelInputChange(channelId, changedKind, write);
  return async (trx, now) => {
    const changed = await change(trx, now);
    if (changed.affectedChannelIds.length === 0) return changed;
    return {
      ...changed,
      afterRegeneration: async (trx, advanced) => {
        if (!advanced.has(channelId)) {
          await advanceScheduleRevision(trx, channelId, now);
        }
      },
    };
  };
}

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { findAiringItem } from "../playout/persistence/playout-reads.js";
import { channelInputChange } from "../schedules/channel-input-change.js";
import type { ScheduleInputChange } from "../schedules/contracts.js";
import { advanceScheduleRevision } from "../schedules/persistence/schedule-repository.js";
import { AiringFillerConflictError } from "./airing-filler-conflict-error.js";

/**
 * Wraps a reservation write as a channel input change that regenerates the
 * channel when the write reports `changedKind`, and advances its schedule
 * revision exactly once in the same commit even when no entry changed,
 * because a reservation also decides planned filler (ADR 0014). The planned
 * filler airing before the write must end where it did after the
 * regeneration; otherwise the whole commit rolls back with
 * `AiringFillerConflictError`, so no write can move an airing resume time.
 */
export function reservationChange<T extends { kind: string }>(
  channelId: string,
  changedKind: T["kind"],
  write: (trx: Kysely<DatabaseSchema>, now: number) => Promise<T>,
): ScheduleInputChange<T> {
  const change = channelInputChange(channelId, changedKind, write);
  return async (trx, now) => {
    const airing = await findAiringItem(trx, channelId, now);
    const changed = await change(trx, now);
    if (changed.affectedChannelIds.length === 0) return changed;
    return {
      ...changed,
      afterRegeneration: async (trx, advanced) => {
        if (airing?.kind === "filler") {
          const after = await findAiringItem(trx, channelId, now);
          if (after?.kind !== "filler" || after.endsAt !== airing.endsAt) {
            throw new AiringFillerConflictError(airing.endsAt);
          }
        }
        if (!advanced.has(channelId)) {
          await advanceScheduleRevision(trx, channelId, now);
        }
      },
    };
  };
}

import { turnTerms } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { channelInputChange } from "../schedules/channel-input-change.js";
import type { ScheduleInputChange } from "../schedules/contracts.js";
import { loadProgrammingAssignments } from "../schedules/persistence/assignment-sources.js";
import {
  findStartedTurn,
  markTurnEnded,
} from "../schedules/persistence/generated-blocks.js";
import { loadProgrammingRules } from "./rule-rows.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Wraps a rule write as a channel input change that ends the started turn
 * after the airing program when the write changes the terms that turn runs
 * under at the regeneration boundary: its rotation context, its source\x27s
 * eligibility, or its effective stretch settings (programming spec 0005).
 * An edit that changes none of them keeps the turn running. kraziBrain
 * decides the terms; this only compares them before and after.
 */
export function ruleChange<T extends { kind: string }>(
  channelId: string,
  changedKind: T["kind"],
  timeZone: string,
  write: (trx: Executor, now: number) => Promise<T>,
): ScheduleInputChange<T> {
  return channelInputChange(channelId, changedKind, async (trx, now) => {
    const started = await findStartedTurn(trx, channelId, now);
    const terms = async () =>
      started?.block.assignmentId == null
        ? undefined
        : JSON.stringify(
            turnTerms(
              await loadProgrammingRules(trx, channelId),
              await loadProgrammingAssignments(trx, channelId),
              started.boundary,
              timeZone,
              started.block.assignmentId,
            ),
          );
    const before = await terms();
    const value = await write(trx, now);
    if (
      started !== undefined &&
      value.kind === changedKind &&
      before !== (await terms())
    ) {
      await markTurnEnded(trx, started.block.id);
    }
    return value;
  });
}

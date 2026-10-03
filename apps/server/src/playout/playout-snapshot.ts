import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ScheduleState } from "../schedules/contracts.js";
import {
  checkCoverage,
  effectiveNow,
  resolveTarget,
  scheduleRevisionOrZero,
} from "../schedules/schedule-coverage.js";
import {
  findChannelEnabled,
  loadScheduleState,
} from "../schedules/schedule-repository.js";
import type {
  CoverageRequirement,
  PlayoutSnapshot,
  PlayoutSnapshotOptions,
  PlayoutSnapshotRead,
} from "./contracts.js";

/**
 * Reads one playout result from a single schedule snapshot: a deferred read
 * transaction whose first statement, the revision read, fixes the SQLite
 * snapshot every later row comes from. It never writes; a channel whose
 * coverage falls short reports the target a coverage write must reach.
 *
 * `db` exposes only `transaction` and `read` receives only `trx`, so no
 * statement can run on the root handle, which would wait on the connection
 * this transaction holds.
 */
export async function readPlayoutSnapshot<T>(
  db: Pick<Kysely<DatabaseSchema>, "transaction">,
  channelId: string,
  now: number,
  options: PlayoutSnapshotOptions,
  read: PlayoutSnapshotRead<T>,
): Promise<PlayoutSnapshot<T>> {
  return db.transaction().execute(async (trx) => {
    const state = await loadScheduleState(trx, channelId);
    await options.afterRevisionRead?.();
    const enabled = await findChannelEnabled(trx, channelId);
    if (enabled === undefined) return { kind: "not_found" };
    if (!enabled) return { kind: "disabled" };

    const shortfall = findCoverageShortfall(options.coverage, state, now);
    if (shortfall !== undefined) return shortfall;

    const scheduleRevision = scheduleRevisionOrZero(state);
    return {
      kind: "ok",
      scheduleRevision,
      value: await read(trx, scheduleRevision),
    };
  });
}

/**
 * Returns why the channel's coverage fails the requirement, or undefined when
 * it is met. A horizon is aimed with exactly the target `ensureCoverage`
 * would aim for, so the retry's write satisfies it.
 */
function findCoverageShortfall(
  requirement: CoverageRequirement,
  state: ScheduleState | undefined,
  now: number,
):
  | Extract<
      PlayoutSnapshot<never>,
      { kind: "coverage_needed" | "through_out_of_range" }
    >
  | undefined {
  if (requirement.kind === "none") return undefined;
  const target =
    requirement.kind === "target"
      ? requirement.target
      : resolveTarget(effectiveNow(now, state?.updatedAt), requirement.through);
  if (typeof target !== "number") return target;
  return checkCoverage(state, target) === undefined
    ? { kind: "coverage_needed", target }
    : undefined;
}

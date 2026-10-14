import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { findAssignedCollectionMode } from "../schedules/persistence/assignment-sources.js";
import { resetProgress } from "../schedules/persistence/collection-progress.js";
import { loadScheduleState } from "../schedules/persistence/schedule-repository.js";
import type { ProgressResetResult } from "./contracts.js";

/**
 * Restarts the channel's progress through one of an assignment's
 * collections, in the assignment's mode, from the beginning, inside the
 * schedule transaction that then regenerates the channel. The first
 * regenerated entry takes the channel's next sequence number, so that
 * number marks where post-reset entries begin.
 */
export async function resetCollectionProgress(
  trx: Kysely<DatabaseSchema>,
  member: {
    channelId: string;
    assignmentId: string;
    mediaCollectionId: string;
  },
  now: number,
): Promise<ProgressResetResult> {
  const playbackMode = await findAssignedCollectionMode(trx, member);
  if (playbackMode === undefined) return { kind: "not_assigned" };
  const state = await loadScheduleState(trx, member.channelId);
  await resetProgress(
    trx,
    {
      channelId: member.channelId,
      mediaCollectionId: member.mediaCollectionId,
      playbackMode,
    },
    state?.nextSequenceNumber ?? 0,
    now,
  );
  return { kind: "reset" };
}

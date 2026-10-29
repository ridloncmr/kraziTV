import type {
  CollectionProgress,
  ProgrammingAssignment,
  Reservation,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { loadProgrammingRules } from "../../programming-rules/rule-rows.js";
import { loadReservations } from "../../reservations/persistence/reservation-rows.js";
import {
  loadMarathonSettings,
  loadProgrammingAssignments,
} from "./assignment-sources.js";
import { loadProgress, readRestoredProgress } from "./collection-progress.js";
import { loadLatestTurn } from "./generated-blocks.js";
import { listRestorableEntriesFrom } from "./schedule-repository.js";

/**
 * Loads everything kraziPlan reads from storage for a channel generating
 * from `startsAt`. Without `keptBefore` it reads the state as stored, as
 * generation continues it; with it, it reads what a regeneration from that
 * boundary would keep: the latest turn and aired totals before it, and the
 * progress the entries from it would restore to. Only reservations ending
 * after the latest turn began can still matter to generation. The schedule
 * writer and previews share it, so a preview reads what a write would.
 */
export async function loadProgrammingInputs(
  trx: Kysely<DatabaseSchema>,
  channelId: string,
  startsAt: number,
  keptBefore?: number,
) {
  const assignments = await loadProgrammingAssignments(trx, channelId);
  const latestTurn = await loadLatestTurn(trx, channelId, keptBefore);
  const reservations = await loadReservations(
    trx,
    channelId,
    Math.min(latestTurn?.block.startsAt ?? startsAt, startsAt),
  );
  const collections = [
    ...assignedCollections(assignments),
    ...reservedCollections(reservations),
  ];
  const stored = await loadProgress(trx, channelId, collections);
  const restored =
    keptBefore === undefined
      ? []
      : await readRestoredProgress(
          trx,
          channelId,
          await listRestorableEntriesFrom(trx, channelId, keptBefore),
          keptBefore,
        );
  const key = (entry: CollectionProgress) =>
    `${entry.mediaCollectionId}\u0000${entry.playbackMode}`;
  const restoredKeys = new Set(restored.map(key));
  return {
    assignments,
    rules: await loadProgrammingRules(trx, channelId),
    reservations,
    collections,
    marathons: await loadMarathonSettings(trx, channelId),
    latestTurn,
    progress: [
      ...stored.filter((entry) => !restoredKeys.has(key(entry))),
      ...restored,
    ],
  };
}

/**
 * Lists each collection the reservations play, with its mode and members,
 * because a collection reservation consumes the same progress a generated
 * turn does and its order is the one the schedule follows.
 */
function reservedCollections(reservations: readonly Reservation[]) {
  return reservations.flatMap(({ source }) =>
    source.kind === "collection"
      ? [
          {
            mediaCollectionId: source.mediaCollectionId,
            playbackMode: source.playbackMode,
            members: source.members,
          },
        ]
      : [],
  );
}

/**
 * Lists each collection the assignments play, with the mode its assignment
 * plays it in and its members, so generation loads their progress and a
 * new schedule records the order each metadata mode follows.
 */
function assignedCollections(assignments: readonly ProgrammingAssignment[]) {
  return assignments.flatMap(({ playbackMode, members }) =>
    playbackMode === null
      ? []
      : members.flatMap((member) =>
          member.kind === "collection"
            ? [
                {
                  mediaCollectionId: member.mediaCollectionId,
                  playbackMode,
                  members: member.members,
                },
              ]
            : [],
        ),
  );
}

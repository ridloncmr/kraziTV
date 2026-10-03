// Seeds a schedule two connections race over; production code must never import this module.
import type { Kysely } from "kysely";

import type { ImmediateTransactionHooks } from "../database/writes/immediate-transaction.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { FIXTURE_TIME } from "./catalog-fixtures.js";
import { sequentialIds } from "./record-sources.js";
import { recordingLog } from "./recording-log.js";
import {
  readOnlyScheduleState,
  seedScheduleScenario,
} from "./schedule-fixtures.js";
import {
  createTemporaryDirectory,
  openTestDatabase,
} from "./test-environment.js";

/** Each of the three episodes runs exactly this long, so boundaries fall on the hour. */
export const RACING_EPISODE_MS = 3_600_000;

export interface RacingSchedule {
  /** The connection that seeded the schedule; regeneration runs here. */
  writer: Kysely<DatabaseSchema>;
  /**
   * A second connection to the same file. One Kysely instance would
   * serialize both sides behind its single connection and hide the race.
   */
  other: Kysely<DatabaseSchema>;
  channelId: string;
  /** The revision the `original-*` coverage committed. */
  scheduleRevision: number;
}

/**
 * Covers a channel of three hour-long chronological episodes from
 * FIXTURE_TIME with `original-*` entries, so a race test names the entries
 * it expects regeneration to keep or replace.
 */
export async function openRacingSchedule(): Promise<RacingSchedule> {
  const dataDirectory = await createTemporaryDirectory();
  const writer = (await openTestDatabase(dataDirectory)).db;
  const other = (await openTestDatabase(dataDirectory)).db;
  const { channelId } = await seedScheduleScenario(writer, {
    items: [1, 2, 3].map(() => ({ durationMs: RACING_EPISODE_MS })),
    source: "chronological",
  });
  await new ScheduleService(writer, {
    now: () => FIXTURE_TIME,
    createId: sequentialIds("original"),
  }).ensureCoverage(channelId, recordingLog());
  const { schedule_revision } = await readOnlyScheduleState(writer);
  return { writer, other, channelId, scheduleRevision: schedule_revision };
}

/**
 * A schedule service on the writer that mutates at a fixed `now` and names
 * its entries `regenerated-*`; hooks let a test pause or observe it.
 */
export function racingRegenerator(
  writer: Kysely<DatabaseSchema>,
  now: number,
  transactionHooks?: ImmediateTransactionHooks,
): ScheduleService {
  return new ScheduleService(writer, {
    now: () => now,
    createId: sequentialIds("regenerated"),
    transactionHooks,
  });
}

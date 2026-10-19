import type { Kysely } from "kysely";
import { afterEach, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ImmediateTransactionHooks } from "../database/writes/immediate-transaction.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import {
  FIXTURE_TIME,
  titledItemFixture,
} from "../testing/catalog-fixtures.js";
import { openRacingSchedule } from "../testing/racing-schedule.js";
import { recordingLog } from "../testing/recording-log.js";
import { createBarrier } from "../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";
import { ReservationRepository } from "./persistence/reservation-repository.js";
import type { SaveGuards } from "./contracts.js";
import { reservationChange } from "./reservation-change.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 3_600_000;

// Creates a two-hour movie reservation at `startsAt` through `db`, saved
// from a preview of `guards.expectedProgrammingRevision`.
function create(
  db: Kysely<DatabaseSchema>,
  channelId: string,
  startsAt: number,
  guards: SaveGuards,
  hooks?: ImmediateTransactionHooks,
) {
  const reservations = new ReservationRepository(db);
  return new ScheduleService(db, {
    now: () => FIXTURE_TIME,
    transactionHooks: hooks,
  }).applyInputChange(
    recordingLog(),
    "reservation_created",
    reservationChange(channelId, "created", (trx, now) =>
      reservations.create(
        trx,
        channelId,
        {
          startsAt,
          endsAt: null,
          interrupts: false,
          source: { kind: "media_items", mediaItemIds: ["movie"] },
        },
        guards,
        now,
      ),
    ),
  );
}

it("refuses the second of two saves made at once from one preview as stale", async () => {
  const { writer, other, channelId, programmingRevision } =
    await openRacingSchedule();
  const guards = { expectedProgrammingRevision: programmingRevision };
  await writer
    .insertInto("media_items")
    .values(titledItemFixture("movie", { duration_ms: 2 * HOUR }))
    .execute();
  const paused = createBarrier();
  const blocked = createBarrier();

  // The first holds write authority before reading anything; the second
  // finds it held and must wait, then sees the first's reservation.
  const first = create(writer, channelId, FIXTURE_TIME + 3 * HOUR, guards, {
    afterBegin: () => paused.wait(),
  });
  await paused.reached;
  const second = create(other, channelId, FIXTURE_TIME + 4 * HOUR, guards, {
    onBusy: () => void blocked.wait(),
  });
  await blocked.reached;
  paused.release();
  blocked.release();

  const results = await Promise.all([first, second]);

  expect(results.map((result) => result.kind)).toEqual([
    "created",
    "preview_stale",
  ]);
  await expect(
    writer.selectFrom("reservations").select("starts_at").execute(),
  ).resolves.toEqual([{ starts_at: FIXTURE_TIME + 3 * HOUR }]);
});

it("creates one reservation and advances the revision once for two saves at once with one key", async () => {
  const { writer, other, channelId, scheduleRevision, programmingRevision } =
    await openRacingSchedule();
  await writer
    .insertInto("media_items")
    .values(titledItemFixture("movie", { duration_ms: 2 * HOUR }))
    .execute();
  const guards = {
    expectedProgrammingRevision: programmingRevision,
    requestKey: "save-1",
  };
  const paused = createBarrier();
  const blocked = createBarrier();

  // A retry that reaches the server while the first save still holds write
  // authority finds that save's reservation once it may read.
  const first = create(writer, channelId, FIXTURE_TIME + 3 * HOUR, guards, {
    afterBegin: () => paused.wait(),
  });
  await paused.reached;
  const retry = create(other, channelId, FIXTURE_TIME + 3 * HOUR, guards, {
    onBusy: () => void blocked.wait(),
  });
  await blocked.reached;
  paused.release();
  blocked.release();

  const results = await Promise.all([first, retry]);

  expect(results.map((result) => result.kind)).toEqual(["created", "repeated"]);
  await expect(
    writer.selectFrom("reservations").select("starts_at").execute(),
  ).resolves.toEqual([{ starts_at: FIXTURE_TIME + 3 * HOUR }]);
  const { schedule_revision } = await writer
    .selectFrom("channel_schedule_states")
    .select("schedule_revision")
    .executeTakeFirstOrThrow();
  expect(schedule_revision).toBe(scheduleRevision + 1);
});

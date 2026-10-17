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
import { reservationChange } from "./reservation-change.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 3_600_000;

// Creates a two-hour movie reservation at `startsAt` through `db`.
function create(
  db: Kysely<DatabaseSchema>,
  channelId: string,
  startsAt: number,
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
          source: { kind: "media_items", mediaItemIds: ["movie"] },
        },
        now,
      ),
    ),
  );
}

it("leaves one of two overlapping reservations created at once on separate connections", async () => {
  const { writer, other, channelId } = await openRacingSchedule();
  await writer
    .insertInto("media_items")
    .values(titledItemFixture("movie", { duration_ms: 2 * HOUR }))
    .execute();
  const paused = createBarrier();
  const blocked = createBarrier();

  // The first holds write authority before reading anything; the second
  // finds it held and must wait, then sees the first's reservation.
  const first = create(writer, channelId, FIXTURE_TIME + 3 * HOUR, {
    afterBegin: () => paused.wait(),
  });
  await paused.reached;
  const second = create(other, channelId, FIXTURE_TIME + 4 * HOUR, {
    onBusy: () => void blocked.wait(),
  });
  await blocked.reached;
  paused.release();
  blocked.release();

  const results = await Promise.all([first, second]);

  expect(results.map((result) => result.kind)).toEqual([
    "created",
    "reservation_overlap",
  ]);
  await expect(
    writer.selectFrom("reservations").select("starts_at").execute(),
  ).resolves.toEqual([{ starts_at: FIXTURE_TIME + 3 * HOUR }]);
});

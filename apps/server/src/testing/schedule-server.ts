// Boots schedule-backed servers for tests only; production code must never import this module.
import { ScheduleService } from "../schedules/schedule-service.js";
import {
  FIXTURE_TIME,
  rootFixture,
  titledItemFixture,
} from "./catalog-fixtures.js";
import { manualClock, type ManualClock } from "./manual-clock.js";
import { sequentialIds } from "./record-sources.js";
import {
  seedScheduleScenario,
  type ScheduleScenarioOptions,
} from "./schedule-fixtures.js";
import {
  createTemporaryDirectory,
  startTestServer,
  type StartTestServerOptions,
} from "./test-environment.js";

const MINUTE = 60_000;

// Three episodes and two features, sized so acceptance tests can name
// exact boundaries.
const ACCEPTANCE_CATALOG = [
  titledItemFixture("pilot", { duration_ms: 22 * MINUTE }),
  titledItemFixture("second", { duration_ms: 23 * MINUTE }),
  titledItemFixture("finale", { duration_ms: 24 * MINUTE }),
  titledItemFixture("feature-a", { duration_ms: 90 * MINUTE }),
  titledItemFixture("feature-b", { duration_ms: 100 * MINUTE }),
];

// Three chronological episodes, the scenario route tests start from.
const EPISODE_SCENARIO: ScheduleScenarioOptions = {
  items: [22, 23, 24].map((minutes) => ({ durationMs: minutes * MINUTE })),
  source: "chronological",
};

/**
 * Composes the server the way index.ts does, on the test's clock. Only
 * `schedules` is overridden, so the default playout service shares its clock.
 * Each boot gets its own ID prefix so entries from different boots never
 * collide; `seedCatalog` writes the acceptance catalog on first boot.
 */
export async function startScheduleServer(
  dataDirectory: string,
  clock: ManualClock,
  boot: string,
  options: { seedCatalog?: boolean } = {},
) {
  const { server, db } = await startTestServer({
    dataDirectory,
    seed: async (db) => {
      if (!options.seedCatalog) return;
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db.insertInto("media_items").values(ACCEPTANCE_CATALOG).execute();
    },
    overrides: (db) => ({
      schedules: new ScheduleService(db, {
        now: clock.now,
        createId: sequentialIds(`${boot}-entry`),
      }),
    }),
  });
  await server.ready();
  return { server, db };
}

/**
 * Boots the real composition over a seeded schedule scenario, by default
 * three chronological episodes, on a manual clock at FIXTURE_TIME. Only
 * `schedules` is overridden, so the default playout service shares its
 * clock. The data directory is returned so a test can open a second
 * connection to the same file, and the dependencies so a test can reach
 * the default recording runtime. Pass a logger to assert what the server
 * logs, or a stop deadline for hung-stop tests.
 */
export async function startScheduleScenarioServer(
  scenario: Partial<ScheduleScenarioOptions> = {},
  options: Pick<StartTestServerOptions, "logger" | "channelStopTimeoutMs"> = {},
) {
  const dataDirectory = await createTemporaryDirectory();
  const clock = manualClock(FIXTURE_TIME);
  const { server, db, dependencies } = await startTestServer({
    dataDirectory,
    logger: options.logger,
    channelStopTimeoutMs: options.channelStopTimeoutMs,
    seed: async (db) => {
      await seedScheduleScenario(db, { ...EPISODE_SCENARIO, ...scenario });
    },
    overrides: (db) => ({
      schedules: new ScheduleService(db, {
        now: clock.now,
        createId: sequentialIds("entry"),
      }),
    }),
  });
  await server.ready();
  return { server, db, clock, dataDirectory, dependencies };
}

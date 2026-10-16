import { afterEach, describe, expect, it } from "vitest";

import { send } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  insertCollectionOfItems,
  readScheduleEntries,
  seedScheduleScenario,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import { AssignmentRepository } from "../programming-assignments/persistence/assignment-repository.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { RuleRepository } from "./rule-repository.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
// Monday 2024-12-02, midday UTC.
const DECEMBER_2 = Date.parse("2024-12-02T12:00:00Z");
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const ASSIGNMENTS_URL = `/channels/${CHANNEL_ID}/programming-assignments`;
const RULES_URL = `/channels/${CHANNEL_ID}/programming-rules`;

// The December join rule selecting the rule-only Christmas assignment.
const decemberBody = {
  name: "December",
  behavior: "join",
  priority: 1,
  dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
  weekdays: null,
  window: null,
  sources: [{ assignmentId: "assignment-002" }],
};

// Boots the real composition at `now` over a channel playing the fixture
// collection's three 22-minute episodes (assignment-001), with a rule-only
// Christmas collection of two 90-minute films (assignment-002).
async function startServer(now = DECEMBER_2, programmingTimezone?: string) {
  const clock = manualClock(now);
  const { server, db } = await startTestServer({
    seed: async (db) => {
      await seedScheduleScenario(db, {
        items: [22, 22, 22].map((minutes) => ({
          durationMs: minutes * MINUTE,
        })),
        source: null,
      });
      await insertCollectionOfItems(db, "christmas", [
        90 * MINUTE,
        90 * MINUTE,
      ]);
    },
    overrides: (db) => ({
      assignments: new AssignmentRepository(db, {
        createId: sequentialIds("assignment"),
      }),
      rules: new RuleRepository(db, { createId: sequentialIds("rule") }),
      schedules: new ScheduleService(db, {
        now: clock.now,
        programmingTimezone,
      }),
    }),
  });
  await send(
    server,
    "POST",
    ASSIGNMENTS_URL,
    collectionAssignment(COLLECTION_ID),
  );
  await send(server, "POST", ASSIGNMENTS_URL, {
    ...collectionAssignment("christmas"),
    participation: "rule_only",
    ordinaryStretch: { kind: "programs", count: 1 },
  });
  return { server, db, clock };
}

// Whether any entry from `from` airs the Christmas collection.
async function airsChristmas(
  db: Awaited<ReturnType<typeof startServer>>["db"],
  from = 0,
) {
  const entries = await readScheduleEntries(db, CHANNEL_ID);
  return entries.some(
    (entry) =>
      entry.media_collection_id === "christmas" && entry.starts_at >= from,
  );
}

describe("programming rule routes", () => {
  it("lists no rules for a channel without any, and reports an unknown channel", async () => {
    const { server } = await startServer();

    await expect(send(server, "GET", RULES_URL)).resolves.toEqual({
      status: 200,
      body: [],
    });
    await expect(
      send(server, "GET", "/channels/missing/programming-rules"),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: { code: "channel_not_found" } },
    });
  });

  it("creates a December join rule, lists it, and airs its source in rotation", async () => {
    const { server, db } = await startServer();
    expect(await airsChristmas(db)).toBe(false);
    const expected = {
      id: "rule-001",
      channelId: CHANNEL_ID,
      ...decemberBody,
      createdAt: new Date(DECEMBER_2).toISOString(),
      updatedAt: new Date(DECEMBER_2).toISOString(),
    };

    await expect(
      send(server, "POST", RULES_URL, decemberBody),
    ).resolves.toEqual({ status: 201, body: expected });
    await expect(send(server, "GET", RULES_URL)).resolves.toEqual({
      status: 200,
      body: [expected],
    });
    expect(await airsChristmas(db)).toBe(true);
  });

  it("keeps the rule-only source off the schedule outside its dates", async () => {
    const { server, db } = await startServer(
      Date.parse("2024-07-01T12:00:00Z"),
    );

    await send(server, "POST", RULES_URL, decemberBody);

    expect(await airsChristmas(db)).toBe(false);
  });

  it("evaluates the rule in the programming timezone", async () => {
    const evenings = {
      ...decemberBody,
      dates: { kind: "any" },
      window: { startMinute: 18 * 60, endMinute: 19 * 60 },
    };
    const { server, db } = await startServer(
      Date.parse("2024-12-02T12:00:00Z"),
      "America/New_York",
    );

    await send(server, "POST", RULES_URL, evenings);

    const films = (await readScheduleEntries(db, CHANNEL_ID)).filter(
      (entry) => entry.media_collection_id === "christmas",
    );
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) {
      // 18:00-19:00 EST is 23:00-24:00 UTC.
      expect(new Date(film.starts_at).getUTCHours()).toBe(23);
    }
  });

  it("stops airing the source after the airing entry once the rule is deleted", async () => {
    const { server, db, clock } = await startServer();
    await send(server, "POST", RULES_URL, decemberBody);
    clock.advance(10 * MINUTE);
    const [airing] = (await readScheduleEntries(db, CHANNEL_ID))
      .filter((entry) => entry.starts_at <= clock.now())
      .slice(-1);

    await expect(
      send(server, "DELETE", `${RULES_URL}/rule-001`),
    ).resolves.toMatchObject({ status: 204 });

    expect(await airsChristmas(db, airing?.ends_at ?? 0)).toBe(false);
    await expect(send(server, "GET", RULES_URL)).resolves.toMatchObject({
      body: [],
    });
  });

  it("replaces a rule's settings and regenerates", async () => {
    const { server, db } = await startServer();
    await send(server, "POST", RULES_URL, decemberBody);

    const response = await send(server, "PATCH", `${RULES_URL}/rule-001`, {
      ...decemberBody,
      dates: { kind: "annual", startMonthDay: "07-01", endMonthDay: "07-31" },
    });

    expect(response).toMatchObject({
      status: 200,
      body: { dates: { kind: "annual", startMonthDay: "07-01" } },
    });
    expect(await airsChristmas(db, DECEMBER_2 + 3 * 60 * MINUTE)).toBe(false);
  });

  it("saves no weekdays as every day, and reads a stored empty mask the same way", async () => {
    const { server, db } = await startServer();

    const created = await send(server, "POST", RULES_URL, {
      ...decemberBody,
      weekdays: [],
    });
    expect(created).toMatchObject({ status: 201, body: { weekdays: null } });

    await db.updateTable("programming_rules").set({ weekdays: 0 }).execute();
    await expect(send(server, "GET", RULES_URL)).resolves.toMatchObject({
      body: [{ weekdays: null }],
    });
    expect(await airsChristmas(db)).toBe(true);
  });

  it("writes nothing for identical settings, even with weekdays in another order", async () => {
    const { server, db } = await startServer();
    const fridays = { ...decemberBody, weekdays: [5, 1] };
    await send(server, "POST", RULES_URL, fridays);
    const revision = async () =>
      (
        await db
          .selectFrom("channel_schedule_states")
          .select("schedule_revision")
          .executeTakeFirstOrThrow()
      ).schedule_revision;
    const before = await revision();

    const response = await send(server, "PATCH", `${RULES_URL}/rule-001`, {
      ...fridays,
      weekdays: [1, 5],
    });

    expect(response).toMatchObject({ status: 200, body: { weekdays: [1, 5] } });
    expect(await revision()).toBe(before);
  });

  it("saves a new rule order and refuses one that does not name each rule once", async () => {
    const { server } = await startServer();
    await send(server, "POST", RULES_URL, decemberBody);
    await send(server, "POST", RULES_URL, { ...decemberBody, name: "Second" });

    const reordered = await send(server, "PUT", `${RULES_URL}/order`, {
      ruleIds: ["rule-002", "rule-001"],
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.map((rule: { id: string }) => rule.id)).toEqual([
      "rule-002",
      "rule-001",
    ]);

    await expect(
      send(server, "PUT", `${RULES_URL}/order`, { ruleIds: ["rule-001"] }),
    ).resolves.toMatchObject({
      status: 409,
      body: {
        error: {
          code: "programming_rule_order_mismatch",
          ruleIds: ["rule-002", "rule-001"],
        },
      },
    });
  });

  it("deletes an assignment a rule selects, keeping the rule without it", async () => {
    const { server, db } = await startServer();
    await send(server, "POST", RULES_URL, decemberBody);

    await expect(
      send(server, "DELETE", `${ASSIGNMENTS_URL}/assignment-002`),
    ).resolves.toMatchObject({ status: 204 });

    await expect(send(server, "GET", RULES_URL)).resolves.toMatchObject({
      body: [{ id: "rule-001", sources: [] }],
    });
    expect(await airsChristmas(db, DECEMBER_2 + 3 * 60 * MINUTE)).toBe(false);
  });

  it("refuses a source the channel does not have", async () => {
    const { server } = await startServer();

    await expect(
      send(server, "POST", RULES_URL, {
        ...decemberBody,
        sources: [{ assignmentId: "missing" }],
      }),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "programming_assignment_not_found",
          assignmentId: "missing",
        },
      },
    });
  });

  it("refuses invalid calendar conditions with kraziBrain's reason", async () => {
    const { server } = await startServer();

    const response = await send(server, "POST", RULES_URL, {
      ...decemberBody,
      window: { startMinute: 600, endMinute: 600 },
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      "a window must not start and end at the same minute",
    );
  });

  it.each([
    ["no sources", { sources: [] }],
    [
      "a repeated source",
      {
        sources: [
          { assignmentId: "assignment-002" },
          { assignmentId: "assignment-002" },
        ],
      },
    ],
    ["an empty name", { name: "  " }],
    ["a fractional priority", { priority: 1.5 }],
    ["an unknown field", { exclusive: true }],
  ])("refuses %s", async (_, override) => {
    const { server } = await startServer();

    await expect(
      send(server, "POST", RULES_URL, { ...decemberBody, ...override }),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("refuses a feature rule until feature rules are supported", async () => {
    const { server } = await startServer();

    await expect(
      send(server, "POST", RULES_URL, { ...decemberBody, behavior: "feature" }),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "programming_rule_behavior_unsupported" } },
    });
  });

  it("reports an unknown rule on change and delete", async () => {
    const { server } = await startServer();

    for (const method of ["PATCH", "DELETE"] as const) {
      await expect(
        send(
          server,
          method,
          `${RULES_URL}/missing`,
          method === "PATCH" ? decemberBody : undefined,
        ),
      ).resolves.toMatchObject({
        status: 404,
        body: { error: { code: "programming_rule_not_found" } },
      });
    }
  });
});

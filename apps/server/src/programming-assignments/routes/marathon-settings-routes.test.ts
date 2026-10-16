import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import { collectionAssignment } from "../../testing/assignment-bodies.js";
import { insertCollectionOfItems } from "../../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

// The IDs seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const SETTINGS_URL = `/channels/${CHANNEL_ID}/programming-settings`;
const ASSIGNMENTS_URL = `/channels/${CHANNEL_ID}/programming-assignments`;

describe("marathon settings", () => {
  it("reads the defaults, which keep marathons off, then saves new ones", async () => {
    const { server } = await startScheduleScenarioServer({ source: null });

    await expect(send(server, "GET", SETTINGS_URL)).resolves.toEqual({
      status: 200,
      body: { marathonChancePercent: 0, marathonMinOrdinaryRounds: 2 },
    });
    const saved = { marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 };
    await expect(send(server, "PUT", SETTINGS_URL, saved)).resolves.toEqual({
      status: 200,
      body: saved,
    });
    await expect(send(server, "GET", SETTINGS_URL)).resolves.toEqual({
      status: 200,
      body: saved,
    });
  });

  it.each([
    { marathonChancePercent: 101, marathonMinOrdinaryRounds: 2 },
    { marathonChancePercent: 10.5, marathonMinOrdinaryRounds: 2 },
    { marathonChancePercent: 10, marathonMinOrdinaryRounds: -1 },
    { marathonChancePercent: 10 },
  ])("refuses %o", async (body) => {
    const { server } = await startScheduleScenarioServer({ source: null });

    await expect(
      send(server, "PUT", SETTINGS_URL, body),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("reports an unknown channel", async () => {
    const { server } = await startScheduleScenarioServer({ source: null });

    for (const method of ["GET", "PUT"] as const) {
      await expect(
        send(
          server,
          method,
          "/channels/missing/programming-settings",
          method === "PUT"
            ? { marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 }
            : undefined,
        ),
      ).resolves.toMatchObject({
        status: 404,
        body: { error: { code: "channel_not_found" } },
      });
    }
  });
});

describe("marathon stretches", () => {
  it("saves a longer marathon in the same unit and refuses one that is not", async () => {
    const { server } = await startScheduleScenarioServer({ source: null });
    const body = {
      ...collectionAssignment(COLLECTION_ID),
      marathonStretch: { kind: "programs", count: 8 },
    };

    await expect(
      send(server, "POST", ASSIGNMENTS_URL, body),
    ).resolves.toMatchObject({
      status: 201,
      body: { marathonStretch: body.marathonStretch },
    });
    for (const [marathonStretch, reason] of [
      [{ kind: "airtime", minutes: 180 }, "unit"],
      [{ kind: "programs", count: 2 }, "longer"],
    ] as const) {
      const refused = await send(server, "POST", ASSIGNMENTS_URL, {
        ...body,
        marathonStretch,
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain(reason);
    }
  });

  it("airs a marathon turn every round once the channel allows them", async () => {
    const { server, db } = await startScheduleScenarioServer({ source: null });
    await insertCollectionOfItems(db, "parks", Array(4).fill(22 * 60_000));
    await send(server, "POST", ASSIGNMENTS_URL, {
      ...collectionAssignment(COLLECTION_ID),
      ordinaryStretch: { kind: "programs", count: 1 },
      marathonStretch: { kind: "programs", count: 4 },
    });
    await send(server, "POST", ASSIGNMENTS_URL, collectionAssignment("parks"));

    await send(server, "PUT", SETTINGS_URL, {
      marathonChancePercent: 100,
      marathonMinOrdinaryRounds: 0,
    });

    const blocks = await db
      .selectFrom("programming_blocks")
      .select([
        "round_number",
        "marathon",
        "resolved_value",
        "media_collection_id",
      ])
      .where("media_collection_id", "=", COLLECTION_ID)
      .orderBy("starts_at")
      .execute();
    const marathons = blocks.filter((block) => block.marathon === 1);
    expect(marathons.length).toBeGreaterThan(3);
    expect(marathons.every((block) => block.resolved_value === 4)).toBe(true);
  });
});

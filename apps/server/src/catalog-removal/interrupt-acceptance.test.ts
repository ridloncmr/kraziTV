// Spec 0010 acceptance: removing media with airing "interrupt" replaces what
// a channel is airing and stops its stream worker after the commit.
import { afterEach, describe, expect, it } from "vitest";

import { SignalPlayoutAdapter } from "../channels/runtime/signal-playout-adapter.js";
import { send, updateChannel } from "../testing/api-requests.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { RecordingChannelRuntime } from "../testing/recording-channel-runtime.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  readOnlyScheduleState,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import { createBarrier } from "../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; item-001 airs first, from T0 for 22 minutes.
const CHANNEL_ID = "channel-fixture-001";
const [A, B] = ["item-001", "item-002"];
const NOW = T0 + 5 * MINUTE;

// Boots the episode scenario five minutes into item-001 and returns the
// recording runtime the default composition stops channels through.
async function startInterruptServer(channelStopTimeoutMs?: number) {
  const started = await startScheduleScenarioServer(
    {},
    { channelStopTimeoutMs },
  );
  started.clock.set(NOW);
  const runtime = started.dependencies
    .channelRuntime as RecordingChannelRuntime;
  return { ...started, runtime };
}

// Removes item-001 with the given airing choice.
function removeAiring(
  server: Parameters<typeof send>[0],
  airing: "finish" | "interrupt",
) {
  return send(server, "POST", "/catalog-removals", {
    target: { mediaItemIds: [A] },
    airing,
  });
}

describe("catalog removal with airing interrupt", () => {
  it("replaces the airing entry from now, purges the removed item, and stops the worker after the commit", async () => {
    const { server, db, clock, runtime } = await startInterruptServer();
    const revision = (await readOnlyScheduleState(db)).schedule_revision;
    const [airing] = await readScheduleEntries(db, CHANNEL_ID);
    let entriesAtStop: string[] = [];
    runtime.onStop = async () => {
      entriesAtStop = (await readScheduleEntries(db, CHANNEL_ID)).map(
        (entry) => entry.id,
      );
    };

    const removal = await removeAiring(server, "interrupt");

    expect(removal).toEqual({
      status: 200,
      body: {
        removedItemCount: 1,
        finishing: [],
        interruptedChannelIds: [CHANNEL_ID],
        stopFailedChannelIds: [],
        affectedChannelIds: [CHANNEL_ID],
      },
    });
    const entries = await readScheduleEntries(db, CHANNEL_ID);
    // Progress restored from the deleted entries starts the shortened
    // collection over, at its new first member.
    expect(entries[0]).toMatchObject({ starts_at: NOW, media_item_id: B });
    expect(entries.map((entry) => entry.id)).not.toContain(airing?.id);
    expect(entries.some((entry) => entry.media_item_id === A)).toBe(false);
    await expect(readOnlyScheduleState(db)).resolves.toMatchObject({
      schedule_revision: revision + 1,
    });
    // Nothing holds the interrupted item any more, so the same commit purged it.
    await expect(
      db.selectFrom("media_items").select("id").where("id", "=", A).execute(),
    ).resolves.toEqual([]);
    // The stop ran after the commit: it already saw the new schedule.
    expect(runtime.stops).toEqual([
      { channelId: CHANNEL_ID, reason: "interrupted" },
    ]);
    expect(entriesAtStop).toEqual(entries.map((entry) => entry.id));

    clock.advance(MINUTE);
    await expect(
      send(server, "GET", `/channels/${CHANNEL_ID}/now`),
    ).resolves.toMatchObject({
      status: 200,
      body: { currentItem: { mediaItemId: B, offsetMs: MINUTE } },
    });
  });

  it("stops nothing when the airing program finishes", async () => {
    const { server, runtime } = await startInterruptServer();

    await expect(removeAiring(server, "finish")).resolves.toMatchObject({
      status: 200,
      body: { interruptedChannelIds: [], stopFailedChannelIds: [] },
    });
    expect(runtime.stops).toEqual([]);
  });

  it("reports a failed stop without rolling anything back", async () => {
    const { server, db, runtime } = await startInterruptServer();
    runtime.failure = new Error("worker would not stop");

    const removal = await removeAiring(server, "interrupt");

    expect(removal).toMatchObject({
      status: 200,
      body: {
        interruptedChannelIds: [CHANNEL_ID],
        stopFailedChannelIds: [CHANNEL_ID],
      },
    });
    const [first] = await readScheduleEntries(db, CHANNEL_ID);
    expect(first).toMatchObject({ starts_at: NOW, media_item_id: B });
  });

  it("reports a stop that misses its deadline; the worker it never reached recovers at the old entry's end", async () => {
    const { server, db, runtime, dependencies } =
      await startInterruptServer(20);
    const [airing] = await readScheduleEntries(db, CHANNEL_ID);
    const hung = createBarrier();
    runtime.onStop = () => hung.wait();

    try {
      await expect(removeAiring(server, "interrupt")).resolves.toMatchObject({
        status: 200,
        body: { stopFailedChannelIds: [CHANNEL_ID] },
      });
    } finally {
      hung.release();
    }

    // A worker still playing the deleted entry asks for what follows it at
    // the entry's end: its cursor is stale, and fresh selection finds the
    // rebuilt schedule. The existing recovery path, through the real adapter.
    const adapter = new SignalPlayoutAdapter(
      dependencies.playout,
      dependencies.channels,
      recordingLog(),
    );
    await expect(
      adapter.getFollowing(CHANNEL_ID, airing.id, 1),
    ).resolves.toMatchObject({ status: "stale_entry", items: [] });
    await expect(
      adapter.getCurrent(CHANNEL_ID, airing.ends_at),
    ).resolves.toMatchObject({ status: "current", item: { mediaItemId: B } });
  });

  it("makes a disable of the same channel wait for the interrupt's stop", async () => {
    const { server, runtime } = await startInterruptServer();
    const stopping = createBarrier();
    let released = false;
    let disableStoppedAfterRelease: boolean | undefined;
    runtime.onStop = async (stop) => {
      if (stop.reason === "interrupted") return stopping.wait();
      disableStoppedAfterRelease = released;
    };

    const removal = removeAiring(server, "interrupt");
    await stopping.reached;
    const disable = updateChannel(server, CHANNEL_ID, { enabled: false });
    // Event-loop turns, not a timer: enough for a disable that skipped the
    // lock to commit and reach its stop while the interrupt still holds.
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(runtime.stops).toHaveLength(1);
    released = true;
    stopping.release();

    await expect(removal).resolves.toMatchObject({ status: 200 });
    expect((await disable).statusCode).toBe(200);
    expect(runtime.stops).toEqual([
      { channelId: CHANNEL_ID, reason: "interrupted" },
      { channelId: CHANNEL_ID, reason: "disabled" },
    ]);
    expect(disableStoppedAfterRelease).toBe(true);
  });
});

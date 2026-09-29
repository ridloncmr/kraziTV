import { describe, expect, it } from "vitest";

import type { SignalPlayoutItem } from "../index.js";
import { FakeSignalPackager } from "./fake-signal-packager.js";

const item = (scheduleEntryId: string): SignalPlayoutItem => ({
  channelId: "comedy",
  scheduleEntryId,
  mediaItemId: `media-${scheduleEntryId}`,
  mediaPath: `/media/${scheduleEntryId}.mkv`,
  mediaOffsetMs: 0,
  playDurationMs: 30_000,
});

describe("FakeSignalPackager", () => {
  it("starts a synchronously returned session and records the item", () => {
    const packager = new FakeSignalPackager();

    const session = packager.start(item("entry-1"));

    expect(packager.startCalls).toEqual([item("entry-1")]);
    expect(packager.sessions).toEqual([session]);
  });

  it("keeps preparation output-neutral until commit", async () => {
    const packager = new FakeSignalPackager();
    const session = packager.start(item("entry-1"));
    const preparation = await session.prepare(item("entry-2"));

    expect(session.committedItems).toEqual([item("entry-1")]);

    preparation.commit();

    expect(session.committedItems).toEqual([item("entry-1"), item("entry-2")]);
    expect(() => preparation.commit()).toThrow(/already committed/i);
  });

  it("discards an unused preparation idempotently and permits another", async () => {
    const packager = new FakeSignalPackager();
    const session = packager.start(item("entry-1"));
    const preparation = await session.prepare(item("entry-2"));

    await preparation.discard();
    await preparation.discard();

    expect(session.discardedItems).toEqual([item("entry-2")]);
    expect(() => preparation.commit()).toThrow(/discarded/i);
    await expect(session.prepare(item("entry-3"))).resolves.toBeDefined();
  });

  it("allows only its own current preparation to change the session", async () => {
    const packager = new FakeSignalPackager();
    const firstSession = packager.start(item("entry-1"));
    const secondSession = packager.start(item("entry-10"));
    const firstPreparation = await firstSession.prepare(item("entry-2"));
    await secondSession.prepare(item("entry-11"));

    expect(() => secondSession.commitPreparation(firstPreparation)).toThrow(
      /not owned/i,
    );
    firstPreparation.commit();

    expect(firstSession.committedItems).toEqual([
      item("entry-1"),
      item("entry-2"),
    ]);
    expect(secondSession.committedItems).toEqual([item("entry-10")]);
  });

  it("allows at most one outstanding preparation", async () => {
    const packager = new FakeSignalPackager();
    const session = packager.start(item("entry-1"));
    await session.prepare(item("entry-2"));

    await expect(session.prepare(item("entry-3"))).rejects.toThrow(
      /outstanding preparation/i,
    );
  });

  it("stops idempotently and discards an outstanding preparation", async () => {
    const packager = new FakeSignalPackager();
    const session = packager.start(item("entry-1"));
    await session.prepare(item("entry-2"));

    await session.stop();
    await session.stop();

    expect(session.stopCalls).toBe(1);
    expect(session.discardedItems).toEqual([item("entry-2")]);
  });
});

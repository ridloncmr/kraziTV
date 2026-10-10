import {
  scannedLibrary,
  changeAlien,
  stored,
} from "../../testing/metadata-refresh-fixtures.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaItemRepository } from "../../media-items/media-item-repository.js";
import { rootFixture } from "../../testing/catalog-fixtures.js";

import { correctionRow } from "../../testing/metadata-match-fixtures.js";

import { SCAN_ALIEN } from "../../testing/scan-metadata.js";
import { createBarrier } from "../../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

import { MatchChoiceService } from "../match-choice/match-choice-service.js";
import { TmdbKeyService } from "../tmdb-key/tmdb-key-service.js";
import { MetadataRefreshService } from "./metadata-refresh-service.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

const services: MetadataRefreshService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  await cleanUpTestEnvironment();
});

/** Registers each fixture service for shutdown before its database closes. */
async function trackedLibrary() {
  const library = await scannedLibrary();
  services.push(library.refresh);
  return library;
}
describe("MetadataRefreshService", () => {
  it("waits for an awaitable pass at shutdown and starts no lookup after a delayed key read", async () => {
    const library = await trackedLibrary();
    library.clock.advance(150 * DAY_MS);
    const held = createBarrier();
    const readKey = library.keys.readKey.bind(library.keys);
    vi.spyOn(library.keys, "readKey").mockImplementation(async () => {
      const key = await readKey();
      await held.wait();
      return key;
    });
    const pass = library.refresh.refreshDue();
    await held.reached;
    let stopped = false;
    const shutdown = library.refresh.shutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    held.release();
    await Promise.all([pass, shutdown]);
    expect(library.tmdb.paths()).toEqual([]);
    expect(library.runtime.pendingTimerCount).toBe(0);
  });

  it("refreshes facts five months old by TMDB ID, one call per movie, series, and season", async () => {
    const library = await trackedLibrary();
    const { db, tmdb, clock, refresh, firefly } = library;
    changeAlien(library, { title: "Alien: Director's Cut" });
    firefly.name = "Firefly Remastered";
    await db
      .insertInto("metadata_corrections")
      .values(correctionRow(library.alien, { title: "My Alien" }))
      .execute();
    clock.advance(150 * DAY_MS);

    await refresh.refreshDue();

    expect(tmdb.paths()).toEqual([
      "/3/movie/348",
      "/3/tv/1437",
      "/3/tv/1437/season/1",
    ]);
    await expect(stored(library, library.alien)).resolves.toMatchObject({
      state: "matched",
      title: "Alien: Director's Cut",
      fetched_at: clock.now(),
      refresh_error: null,
    });
    await expect(stored(library, library.episode)).resolves.toMatchObject({
      title: "Firefly Remastered 1x5",
      series_name: "Firefly Remastered",
      season_number: 1,
      episode_number: 5,
      fetched_at: clock.now(),
    });
    await expect(
      db
        .selectFrom("metadata_corrections")
        .select("title")
        .where("media_item_id", "=", library.alien)
        .executeTakeFirst(),
    ).resolves.toEqual({ title: "My Alien" });
  });

  it("leaves facts younger than five months alone", async () => {
    const library = await trackedLibrary();
    library.clock.advance(149 * DAY_MS);

    await library.refresh.refreshDue();

    expect(library.tmdb.paths()).toEqual([]);
  });

  it("keeps the match and records why when TMDB is unreachable, then drops the facts at six months", async () => {
    const library = await trackedLibrary();
    const { tmdb, clock, refresh, db } = library;
    const before = await stored(library, library.episode);
    tmdb.unreachable = true;
    clock.advance(150 * DAY_MS);

    await refresh.refreshDue();

    await expect(stored(library, library.episode)).resolves.toEqual({
      ...before,
      refresh_error: expect.any(String),
    });

    await db
      .insertInto("metadata_corrections")
      .values(correctionRow(library.episode, { title: "Mine" }))
      .execute();
    clock.advance(30 * DAY_MS);
    await refresh.refreshDue();

    await expect(stored(library, library.episode)).resolves.toEqual({
      ...before,
      title: null,
      series_name: null,
      release_date: null,
      genres: "[]",
      poster_path: null,
      refresh_error: expect.any(String),
      expired_at: clock.now(),
    });
    const item = await new MediaItemRepository(db).findById(library.episode);
    expect(item?.metadata).toMatchObject({
      matchState: "matched",
      title: "Mine",
      seasonNumber: 1,
      episodeNumber: 5,
      tmdbDataExpired: true,
    });

    tmdb.unreachable = false;
    clock.advance(DAY_MS);
    await refresh.refreshDue();

    await expect(stored(library, library.episode)).resolves.toMatchObject({
      series_name: "Firefly",
      fetched_at: clock.now(),
      refresh_error: null,
      expired_at: null,
    });
  });

  it("records TMDB's 404 for a movie it no longer knows, and keeps the match", async () => {
    const library = await trackedLibrary();
    const { tmdb, clock, refresh } = library;
    tmdb.movies.splice(
      tmdb.movies.findIndex((movie) => movie.id === SCAN_ALIEN.id),
      1,
    );
    clock.advance(150 * DAY_MS);

    await refresh.refreshDue();

    await expect(stored(library, library.alien)).resolves.toMatchObject({
      state: "matched",
      title: "Alien",
      refresh_error: "TMDB answered HTTP 404",
      expired_at: null,
    });
  });

  it("without a key, calls TMDB for nothing and still expires facts at six months", async () => {
    const library = await trackedLibrary();
    const { db, clock, refresh, tmdb } = library;
    await db
      .updateTable("server_settings")
      .set({ tmdb_api_key: null })
      .execute();
    clock.advance(180 * DAY_MS);

    await refresh.refreshDue();

    expect(tmdb.paths()).toEqual([]);
    await expect(stored(library, library.alien)).resolves.toMatchObject({
      state: "matched",
      title: null,
      expired_at: clock.now(),
    });
  });

  it("deletes a candidate list six months old and returns its item to unmatched", async () => {
    const library = await trackedLibrary();
    const { db, clock, refresh } = library;
    const candidates = () =>
      db
        .selectFrom("metadata_match_candidates")
        .select("tmdb_id")
        .where("media_item_id", "=", library.ambiguous)
        .execute();
    clock.advance(179 * DAY_MS);
    await refresh.refreshDue();
    expect(await candidates()).toHaveLength(3);

    clock.advance(DAY_MS);
    await refresh.refreshDue();

    expect(await candidates()).toEqual([]);
    await expect(stored(library, library.ambiguous)).resolves.toMatchObject({
      state: "unmatched",
    });
  });

  it("touches no item under a root a scan or retry job holds", async () => {
    const library = await trackedLibrary();
    const { clock, refresh, tmdb, busy } = library;
    const before = await stored(library, library.alien);
    busy.root = true;
    clock.advance(180 * DAY_MS);

    await refresh.refreshDue();

    expect(tmdb.paths()).toEqual([]);
    await expect(stored(library, library.alien)).resolves.toEqual(before);
  });

  it("discards its answers when a job takes the root while TMDB answers", async () => {
    const library = await trackedLibrary();
    const { clock, refresh, tmdb, busy } = library;
    const before = await stored(library, library.alien);
    changeAlien(library, { title: "Alien: Director's Cut" });
    const held = createBarrier();
    tmdb.holds.set("/3/movie/348", held);
    clock.advance(150 * DAY_MS);

    const pass = refresh.refreshDue();
    await held.reached;
    busy.root = true;
    held.release();
    await pass;

    await expect(stored(library, library.alien)).resolves.toEqual(before);
  });

  it("keeps a rejection made while TMDB answers the refresh", async () => {
    const library = await trackedLibrary();
    const { db, clock, refresh, tmdb, client } = library;
    const held = createBarrier();
    tmdb.holds.set("/3/movie/348", held);
    clock.advance(150 * DAY_MS);

    const pass = refresh.refreshDue();
    await held.reached;
    const choices = new MatchChoiceService(
      db,
      new TmdbKeyService(db, client),
      client,
    );
    await expect(choices.reject(library.alien)).resolves.toEqual({
      kind: "rejected",
    });
    held.release();
    await pass;

    await expect(stored(library, library.alien)).resolves.toMatchObject({
      state: "rejected",
      title: null,
      fetched_at: null,
    });
  });

  it("keeps a lookup retry's answer committed while TMDB answers the refresh", async () => {
    const library = await trackedLibrary();
    const { clock, refresh, tmdb, scanner } = library;
    const held = createBarrier();
    tmdb.holds.set("/3/movie/348", held);
    clock.advance(150 * DAY_MS);

    const pass = refresh.refreshDue();
    await held.reached;
    // A search ignores genres, so the retry still matches Alien.
    changeAlien(library, { genres: ["Retried"] });
    const retried = await scanner.retry({
      scope: "item",
      mediaItemId: library.alien,
    });
    expect(retried.kind).toBe("started");
    await vi.waitFor(() =>
      expect(scanner.status(rootFixture.id)?.phase).toBe("completed"),
    );
    const after = await stored(library, library.alien);
    changeAlien(library, { genres: ["Stale"] });
    held.release();
    await pass;

    expect(after.genres).toBe('["Retried"]');
    await expect(stored(library, library.alien)).resolves.toEqual(after);
  });

  it("calls TMDB for nothing under a disabled root, and still expires its data at six months", async () => {
    const library = await trackedLibrary();
    const { db, clock, refresh, tmdb } = library;
    await db
      .updateTable("media_roots")
      .set({ enabled: 0 })
      .where("id", "=", rootFixture.id)
      .execute();
    clock.advance(150 * DAY_MS);
    await refresh.refreshDue();
    expect(tmdb.paths()).toEqual([]);

    clock.advance(30 * DAY_MS);
    await refresh.refreshDue();

    expect(tmdb.paths()).toEqual([]);
    await expect(stored(library, library.alien)).resolves.toMatchObject({
      state: "matched",
      title: null,
      expired_at: clock.now(),
    });
  });

  it("runs a check asked for during a pass right after it, never alongside, and keeps one pass scheduled", async () => {
    const library = await trackedLibrary();
    const { clock, refresh, tmdb, runtime } = library;
    const passes = vi.spyOn(library.keys, "readKey");
    const held = createBarrier();
    tmdb.holds.set("/3/movie/348", held);
    clock.advance(150 * DAY_MS);

    refresh.checkNow();
    await held.reached;
    refresh.checkNow();
    refresh.checkNow();
    expect(passes).toHaveBeenCalledTimes(1);
    held.release();

    await vi.waitFor(() => expect(runtime.pendingTimerCount).toBe(1));
    expect(passes).toHaveBeenCalledTimes(2);

    refresh.checkNow();
    await vi.waitFor(() => expect(passes).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(runtime.pendingTimerCount).toBe(1));
  });

  it("runs a pass when asked, schedules the next, and on shutdown settles the running lookup and leaves no timer", async () => {
    const library = await trackedLibrary();
    const { clock, refresh, tmdb, runtime } = library;

    refresh.checkNow();
    await vi.waitFor(() => expect(runtime.pendingTimerCount).toBe(1));

    const before = await stored(library, library.alien);
    const held = createBarrier();
    tmdb.holds.set("/3/movie/348", held);
    clock.advance(150 * DAY_MS);
    const second = new MetadataRefreshService({
      db: library.db,
      tmdbKeys: new TmdbKeyService(library.db, library.client),
      tmdb: library.client,
      isScanning: () => false,
      timers: runtime,
      now: clock.now,
      log: library.log,
    });
    second.checkNow();
    await held.reached;
    const stopped = second.shutdown();
    held.release();
    await stopped;

    await expect(stored(library, library.alien)).resolves.toEqual(before);
    await refresh.shutdown();
    expect(runtime.pendingTimerCount).toBe(0);
  });
});

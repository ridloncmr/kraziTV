import {
  lookUpEpisodesInSeries,
  type EpisodeLookup,
  type TmdbClient,
} from "@krazitv/media";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type {
  MatchCandidate,
  MetadataMatchRecord,
  MetadataRefusal,
  ProposalRow,
} from "../contracts.js";
import { storeCorrection } from "../corrections/store-correction.js";
import { replaceMatchRows } from "../persistence/match-rows.js";
import type { TmdbKeyService } from "../tmdb-key/tmdb-key-service.js";
import {
  readTrackFolder,
  readTrackStates,
  type ReadTrack,
  type TrackFolder,
} from "./track-folder.js";
import { proposeTrackMapping } from "./track-proposal.js";

/** One episode of the season a mapping proposes from, as the dialog lists it. */
interface SeasonEpisode {
  number: number;
  title: string | null;
  runtimeMs: number | null;
}

/** What an applied mapping did, counted in tracks. */
interface AppliedMapping {
  mappedCount: number;
  extraCount: number;
  /** Tracks removed while the dialog was open, which nothing was written to. */
  goneCount: number;
}

/** The owner's mapping to apply: one TMDB series season and a row per track. */
interface MappingRequest {
  tmdbSeriesId: number;
  season: number;
  rows: readonly ProposalRow[];
}

/**
 * Maps a folder of disc tracks to one season's episodes. Every step needs a
 * TMDB key, since the series choice and runtimes come from TMDB. TMDB is
 * asked before any write, never inside one (ADR 0013), so Apply re-checks
 * under write authority which tracks are still cataloged and writes only
 * those.
 */
export class TrackMappingService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #tmdbKeys: Pick<TmdbKeyService, "readKey">;
  readonly #tmdb: TmdbClient;
  readonly #now: () => number;

  // Shares the server's one TMDB client, so mapping calls queue with scan
  // lookups under TMDB's rate ceiling.
  constructor(
    db: Kysely<DatabaseSchema>,
    tmdbKeys: Pick<TmdbKeyService, "readKey">,
    tmdb: TmdbClient,
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#tmdbKeys = tmdbKeys;
    this.#tmdb = tmdb;
    this.#now = now;
  }

  /**
   * Reads the tracks mapped together with an item. Refused without a key,
   * so the details view offers the dialog only when it can work.
   */
  async folder(mediaItemId: string): Promise<TrackFolder | MetadataRefusal> {
    const read = await this.#readWithKey(mediaItemId);
    return "kind" in read ? read : read.folder;
  }

  /** Searches TMDB's series by the owner's text, for the series choice. */
  async searchSeries(
    query: string,
  ): Promise<{ candidates: MatchCandidate[] } | MetadataRefusal> {
    const apiKey = await this.#tmdbKeys.readKey();
    if (apiKey === undefined) return { kind: "tmdb_key_missing" };
    const found = await this.#tmdb.searchSeries(apiKey, { title: query });
    if (found.kind === "failed") return lookupFailed(found);
    return {
      candidates: found.value.map((series) => ({
        tmdbId: series.id,
        title: series.title,
        releaseDate: series.releaseDate ?? null,
        posterPath: series.posterPath ?? null,
      })),
    };
  }

  /**
   * Proposes which episode each track holds, beside the season's episodes
   * and runtimes the owner edits rows against. The series is read first, so
   * a season it does not list is refused rather than read as empty.
   */
  async propose(
    mediaItemId: string,
    tmdbSeriesId: number,
    season: number,
  ): Promise<
    { rows: ProposalRow[]; episodes: SeasonEpisode[] } | MetadataRefusal
  > {
    const read = await this.#readWithKey(mediaItemId);
    if ("kind" in read) return read;
    const { apiKey, folder } = read;
    const series = await this.#tmdb.seriesDetails(apiKey, tmdbSeriesId);
    if (series.kind === "failed") return lookupFailed(series);
    if (!series.value.seasons.some((listed) => listed.number === season)) {
      return { kind: "season_not_in_series" };
    }
    const fetched = await this.#tmdb.seasonDetails(
      apiKey,
      tmdbSeriesId,
      season,
    );
    if (fetched.kind === "failed") return lookupFailed(fetched);
    const episodes = fetched.value.episodes.map((episode) => ({
      number: episode.number,
      title: episode.title ?? null,
      runtimeMs: episode.runtimeMs ?? null,
    }));
    return {
      rows: proposeTrackMapping(
        folder.tracks,
        episodes.map(({ number }) => number),
      ),
      episodes,
    };
  }

  /**
   * Applies the owner's rows in one commit. A mapped track takes its TMDB
   * episode as the owner's chosen match, and its series, season, and episode
   * as a correction, so the mapping outlives expiry of TMDB's facts; a
   * skipped track becomes an extra. Either way the track's corrected title,
   * series, season, and episode are replaced and its tags kept. A row naming
   * an item outside the folder refuses the whole mapping; a track removed
   * after the read is left out. Newer decisions or corrections made while
   * TMDB is pending refuse the whole mapping before any writes.
   */
  async apply(
    mediaItemId: string,
    request: MappingRequest,
  ): Promise<AppliedMapping | MetadataRefusal> {
    const read = await this.#readWithKey(mediaItemId);
    if ("kind" in read) return read;
    const { apiKey, folder } = read;
    const tracks = new Map(
      folder.tracks.map((track) => [track.mediaItemId, track]),
    );
    const outside = request.rows.filter((row) => !tracks.has(row.mediaItemId));
    const unknown = await findUnknownMediaItemIds(
      this.#db,
      outside.map((row) => row.mediaItemId),
    );
    // An item removed since the dialog read the folder is gone, not outside it.
    if (unknown.length < outside.length) return { kind: "track_not_in_folder" };

    const rows = request.rows.flatMap((row) => {
      const track = tracks.get(row.mediaItemId);
      return track === undefined ? [] : [{ track, row }];
    });
    const states = await readTrackStates(
      this.#db,
      rows.map(({ track }) => track.mediaItemId),
    );
    const mapped = rows.filter(({ row }) => row.episodeNumber !== null);
    // A mapping that skips every track needs nothing from TMDB.
    const lookups =
      mapped.length === 0
        ? []
        : await lookUpEpisodesInSeries(
            this.#tmdb,
            apiKey,
            request.tmdbSeriesId,
            { title: folder.series ?? "" },
            mapped.map(({ row }) => {
              const number = row.episodeNumber ?? 0;
              return {
                season: request.season,
                episode: { first: number, last: number },
              };
            }),
          );
    const failed = lookups.find((lookup) => lookup.kind === "failed");
    if (failed?.kind === "failed") return lookupFailed(failed);
    if (lookups.some((lookup) => lookup.kind !== "matched")) {
      return { kind: "episode_not_in_series" };
    }

    const lookedUpAt = this.#now();
    const byId = new Map(
      mapped.map(({ track }, index) => [track.mediaItemId, lookups[index]]),
    );
    const entries = rows.map(({ track }) => ({
      id: track.mediaItemId,
      record: mappingRecord(track, byId.get(track.mediaItemId), lookedUpAt),
    }));
    return runImmediateTransaction(this.#db, async (pinned) => {
      const removed = new Set(
        await findUnknownMediaItemIds(
          pinned,
          entries.map(({ id }) => id),
        ),
      );
      const writable = entries.filter(({ id }) => !removed.has(id));
      const current = await readTrackStates(
        pinned,
        writable.map(({ id }) => id),
      );
      if (writable.some(({ id }) => current.get(id) !== states.get(id))) {
        return { kind: "mapping_changed" as const };
      }
      await replaceMatchRows(pinned, writable);
      for (const { id, record } of writable) {
        await storeCorrection(pinned, id, correctionOf(record));
      }
      const extraCount = writable.filter(
        ({ record }) => record.kind === "extra",
      ).length;
      return {
        mappedCount: writable.length - extraCount,
        extraCount,
        goneCount: removed.size + unknown.length,
      };
    });
  }

  /**
   * Reads the owner's key and the tracks mapped with an item, the first step
   * of every mapping read and write; the key is checked first, so without one
   * nothing is read.
   */
  async #readWithKey(
    mediaItemId: string,
  ): Promise<{ apiKey: string; folder: TrackFolder } | MetadataRefusal> {
    const apiKey = await this.#tmdbKeys.readKey();
    if (apiKey === undefined) return { kind: "tmdb_key_missing" };
    const folder = await readTrackFolder(this.#db, mediaItemId);
    return "kind" in folder ? folder : { apiKey, folder };
  }
}

// The record a track's row stores: its episode as the owner's chosen match,
// or an extra when the row skips it.
function mappingRecord(
  track: ReadTrack,
  lookup: EpisodeLookup | undefined,
  lookedUpAt: number,
): MetadataMatchRecord {
  const { pathKey, hints } = track;
  if (lookup === undefined) return { kind: "extra", pathKey, hints };
  return {
    kind: "looked_up",
    pathKey,
    hints,
    lookedUpAt,
    durationMs: track.durationMs,
    lookup,
    chosen: true,
  };
}

// The correction a row stores. A mapped track's series, season, and episode
// are the owner's, and its title is cleared so TMDB's episode title shows;
// an extra holds no episode identity at all.
function correctionOf(record: MetadataMatchRecord) {
  const lookup = record.kind === "looked_up" ? record.lookup : undefined;
  if (lookup?.kind !== "matched" || !("series" in lookup)) {
    return {
      title: null,
      seriesName: null,
      seasonNumber: null,
      episodeNumber: null,
    };
  }
  return {
    title: null,
    seriesName: lookup.series.title,
    seasonNumber: lookup.season,
    episodeNumber: lookup.episodes[0]?.number ?? null,
  };
}

// A TMDB read that failed, as the refusal the routes answer for it.
function lookupFailed({ reason }: { reason: string }): MetadataRefusal {
  return { kind: "lookup_failed", reason };
}

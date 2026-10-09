import type { PathHints } from "../path-hints/contracts.js";
import type { TmdbClient, TmdbTitleQuery } from "../tmdb/tmdb-client.js";
import type { TmdbEpisode, TmdbSeries } from "../tmdb/tmdb-series.js";
import type { TmdbTitleSummary } from "../tmdb/tmdb-title.js";
import { matchTitle, titleQuery, type TitleHints } from "./match-title.js";

/** The season and episode hints of one file under a series folder. */
export type EpisodeHints = Required<Pick<PathHints, "season" | "episode">>;

/**
 * How one episode file's lookup ended, with the series query as match
 * evidence. A match carries every episode of a multi-episode file.
 */
export type EpisodeLookup = { query: TmdbTitleQuery } & (
  | {
      kind: "matched";
      series: TmdbSeries;
      season: number;
      episodes: TmdbEpisode[];
    }
  | { kind: "ambiguous"; candidates: TmdbTitleSummary[] }
  | { kind: "unmatched" }
  | { kind: "failed"; reason: string }
);

/** How a series folder's series resolved before any episode is checked. */
type SeriesResolution =
  | { kind: "series"; series: TmdbSeries }
  | Exclude<EpisodeLookup, { kind: "matched" }>;

/**
 * Looks up the episodes under one series folder, returning one lookup per
 * file in `episodes` order. The folder's series is settled once by the
 * spec's episode rule: one search, and details for the one series it
 * matches. Each hinted season that series lists is then fetched once, and a
 * file matches only when its episodes are there; otherwise it is offered that
 * series. The caller's abort is rethrown once every started request has
 * settled.
 */
export async function lookUpEpisodes(
  client: TmdbClient,
  apiKey: string,
  hints: TitleHints,
  episodes: readonly EpisodeHints[],
  signal?: AbortSignal,
): Promise<EpisodeLookup[]> {
  const query = titleQuery(hints);
  const resolution = await resolveSeries(client, apiKey, hints, query, signal);
  if (resolution.kind !== "series") return episodes.map(() => resolution);

  const { series } = resolution;
  const listed = [...new Set(episodes.map((hint) => hint.season))].filter(
    (season) => series.seasons.some((listed) => listed.number === season),
  );
  const fetched = await settleAll(
    listed.map((season) =>
      client.seasonDetails(apiKey, series.id, season, signal),
    ),
  );
  const seasons = new Map(
    listed.map((season, index) => [season, fetched[index]]),
  );

  return episodes.map(({ season, episode }) => {
    const fetchedSeason = seasons.get(season);
    if (fetchedSeason?.kind === "failed") return { query, ...fetchedSeason };
    const found = [];
    for (let number = episode.first; number <= episode.last; number += 1) {
      const known = fetchedSeason?.value.episodes.find(
        (candidate) => candidate.number === number,
      );
      if (known === undefined) {
        return { query, kind: "ambiguous", candidates: [summaryOf(series)] };
      }
      found.push(known);
    }
    return { query, kind: "matched", series, season, episodes: found };
  });
}

/**
 * Settles which series a folder's episodes belong to by the title rule movies
 * use: only a lone same-titled series agreeing with any year is read further.
 * Several are never told apart by which one holds the hinted episodes, since
 * a scene-labelled special can look like another series' season and the
 * wrong match would be silent.
 */
async function resolveSeries(
  client: TmdbClient,
  apiKey: string,
  hints: TitleHints,
  query: TmdbTitleQuery,
  signal: AbortSignal | undefined,
): Promise<SeriesResolution> {
  const search = await client.searchSeries(apiKey, query, signal);
  if (search.kind === "failed") return { query, ...search };
  const match = matchTitle(hints, search.value);
  if (match.kind !== "matched") return { query, ...match };
  const details = await client.seriesDetails(apiKey, match.result.id, signal);
  return details.kind === "ok"
    ? { kind: "series", series: details.value }
    : { query, ...details };
}

// The candidate form of a series, as its search result offered it.
function summaryOf(series: TmdbSeries): TmdbTitleSummary {
  const { id, title, releaseDate, posterPath } = series;
  return {
    id,
    title,
    ...(releaseDate === undefined ? {} : { releaseDate }),
    ...(posterPath === undefined ? {} : { posterPath }),
  };
}

/**
 * Awaits every request before rethrowing the first rejection, such as the
 * caller's abort, so no request outlives the lookup that started it.
 */
async function settleAll<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

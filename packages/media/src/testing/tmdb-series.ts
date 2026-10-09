import { TmdbClient } from "../tmdb/tmdb-client.js";
import { routedFetch } from "./tmdb-fetch.js";

/** A TMDB `/search/tv` result as TMDB sends it, trimmed to the fields kraziTV reads plus one it ignores. */
export function seriesResult(
  id: number,
  name: string,
  firstAirDate: string,
  posterPath: string | null = `/poster-${id}.jpg`,
) {
  return {
    id,
    name,
    original_name: name,
    first_air_date: firstAirDate,
    poster_path: posterPath,
    popularity: 1_000 - id,
  };
}

/**
 * A TMDB `/tv/{id}` body built from a search result, with episode counts by
 * season number, as TMDB lists them in its `seasons`.
 */
export function seriesDetails(
  result: ReturnType<typeof seriesResult>,
  episodeCounts: Record<number, number>,
) {
  return {
    ...result,
    overview: `About ${result.name}`,
    genres: [{ id: 18, name: "Drama" }],
    seasons: Object.entries(episodeCounts).map(([season, count]) => ({
      id: result.id * 100 + Number(season),
      season_number: Number(season),
      episode_count: count,
      name: `Season ${season}`,
    })),
  };
}

/** A TMDB `/tv/{id}/season/{n}` body with episodes 1 through `count`. */
export function seasonDetails(season: number, count: number) {
  return {
    season_number: season,
    episodes: Array.from({ length: count }, (_, index) => ({
      id: season * 1_000 + index + 1,
      season_number: season,
      episode_number: index + 1,
      name: `Episode ${season}.${index + 1}`,
      air_date: `2002-09-${String(index + 1).padStart(2, "0")}`,
      overview: `What happens in ${season}.${index + 1}`,
    })),
  };
}

/** A series TMDB knows: its search result and episode counts by season. */
interface KnownSeries {
  result: ReturnType<typeof seriesResult>;
  episodeCounts: Record<number, number>;
}

/**
 * A client whose TMDB answers a series search from `byName` by query, and
 * each known series' details and seasons from its episode counts. It records
 * every URL it was asked for.
 */
export function tmdbSeries(byName: Record<string, KnownSeries[]>) {
  const routes: Parameters<typeof routedFetch>[0] = {
    "/3/search/tv": (url) =>
      Response.json({
        results: (byName[url.searchParams.get("query") ?? ""] ?? []).map(
          (series) => series.result,
        ),
      }),
  };
  for (const { result, episodeCounts } of Object.values(byName).flat()) {
    routes[`/3/tv/${result.id}`] = () =>
      Response.json(seriesDetails(result, episodeCounts));
    for (const [season, count] of Object.entries(episodeCounts)) {
      routes[`/3/tv/${result.id}/season/${season}`] = () =>
        Response.json(seasonDetails(Number(season), count));
    }
  }
  const routed = routedFetch(routes);
  return {
    client: new TmdbClient({ fetch: routed.fetch, timeoutMs: 1_000 }),
    urls: routed.urls,
  };
}

/** Known series with deliberately overlapping episode numbers for match tests. */
export const FIREFLY = {
  result: seriesResult(1437, "Firefly", "2002-09-20"),
  episodeCounts: { 0: 1, 1: 14, 2: 10 },
};
export const DOCTOR_WHO_1963 = {
  result: seriesResult(121, "Doctor Who", "1963-11-23"),
  episodeCounts: { 1: 42 },
};
export const DOCTOR_WHO_2005 = {
  result: seriesResult(57243, "Doctor Who", "2005-03-26"),
  episodeCounts: { 1: 13, 2: 14 },
};

// One episode hint, with a range only when `last` is given.
export function episode(season: number, first: number, last = first) {
  return { season, episode: { first, last } };
}

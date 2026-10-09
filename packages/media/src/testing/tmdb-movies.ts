import { TmdbClient } from "../tmdb/tmdb-client.js";
import { routedFetch } from "./tmdb-fetch.js";
/** A TMDB `/search/movie` result as TMDB sends it, trimmed to the fields kraziTV reads plus one it ignores. */
export function searchResult(
  id: number,
  title: string,
  releaseDate: string,
  posterPath: string | null = `/poster-${id}.jpg`,
) {
  return {
    id,
    title,
    original_title: title,
    release_date: releaseDate,
    poster_path: posterPath,
    popularity: 1_000 - id,
  };
}

/** TMDB's `/movie/348` body for Alien, as TMDB sends it. */
export const ALIEN_DETAILS = {
  id: 348,
  title: "Alien",
  release_date: "1979-05-25",
  overview: "During its return to the earth, commercial spaceship Nostromo…",
  poster_path: "/alien.jpg",
  runtime: 117,
  genres: [
    { id: 27, name: "Horror" },
    { id: 878, name: "Science Fiction" },
  ],
  belongs_to_collection: {
    id: 8091,
    name: "Alien Collection",
    poster_path: "/collection.jpg",
  },
};

// Answers a search for each query title from `byTitle`, and each found
// movie's details from its search result.
export function tmdb(
  byTitle: Record<string, ReturnType<typeof searchResult>[]>,
) {
  const results = Object.values(byTitle).flat();
  const routed = routedFetch({
    "/3/search/movie": (url) =>
      Response.json({
        results: byTitle[url.searchParams.get("query") ?? ""] ?? [],
      }),
    ...Object.fromEntries(
      results.map((result) => [
        `/3/movie/${result.id}`,
        () =>
          Response.json(
            result.id === ALIEN_DETAILS.id
              ? ALIEN_DETAILS
              : { ...result, genres: [], belongs_to_collection: null },
          ),
      ]),
    ),
  });
  return {
    client: new TmdbClient({ fetch: routed.fetch, timeoutMs: 1_000 }),
    urls: routed.urls,
  };
}

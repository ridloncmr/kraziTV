import type { TmdbMovieSummary } from "../tmdb/tmdb-movie.js";
// TMDB IDs and popularity order deliberately disagree with release order.
export const THE_THING_1982: TmdbMovieSummary = {
  id: 1091,
  title: "The Thing",
  releaseDate: "1982-06-25",
};
export const THE_THING_2011: TmdbMovieSummary = {
  id: 60935,
  title: "The Thing",
  releaseDate: "2011-10-12",
};
export const THE_THING_1951: TmdbMovieSummary = {
  id: 10785,
  title: "The Thing from Another World",
  releaseDate: "1951-04-06",
};
export const THING_1951: TmdbMovieSummary = {
  ...THE_THING_1951,
  title: "Thing",
};

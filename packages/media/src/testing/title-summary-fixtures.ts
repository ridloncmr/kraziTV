import type { TmdbTitleSummary } from "../tmdb/tmdb-title.js";
// TMDB IDs and popularity order deliberately disagree with release order.
export const THE_THING_1982: TmdbTitleSummary = {
  id: 1091,
  title: "The Thing",
  releaseDate: "1982-06-25",
};
export const THE_THING_2011: TmdbTitleSummary = {
  id: 60935,
  title: "The Thing",
  releaseDate: "2011-10-12",
};
export const THE_THING_1951: TmdbTitleSummary = {
  id: 10785,
  title: "The Thing from Another World",
  releaseDate: "1951-04-06",
};
export const THING_1951: TmdbTitleSummary = {
  ...THE_THING_1951,
  title: "Thing",
};

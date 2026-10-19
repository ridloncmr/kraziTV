import type { Generated } from "kysely";

/** One media item's accepted content facts; unknown facts are null. */
export interface ContentFactsTable {
  media_item_id: string;
  content_type: "movie" | "episode" | "unknown";
  title: string | null;
  /** First release as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`, keeping its precision. */
  release_date: string | null;
  /** JSON array of genre names; `[]` when none are known. */
  genres: string;
  /** The TMDB collection the movie belongs to. */
  franchise_tmdb_id: number | null;
  franchise_name: string | null;
  description: string | null;
  /** TMDB's image path, a series' own for an episode; kraziTV never stores the image. */
  poster_path: string | null;
  /** An episode's TMDB series; null for a movie. */
  series_tmdb_id: number | null;
  series_name: string | null;
  /** An episode's season; `0` is the specials season. */
  season_number: number | null;
  /** An episode's first episode number and, for a multi-episode file, its last. */
  episode_number: number | null;
  last_episode_number: number | null;
  /**
   * 1 for an episode its TMDB season does not list, whose numbers are the
   * file's own; defaults to 0, since rows written before the flag existed
   * were all listed.
   */
  episode_unlisted: Generated<number>;
}

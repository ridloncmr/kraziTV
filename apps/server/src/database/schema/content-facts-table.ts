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
  /** TMDB's image path; kraziTV never stores the image. */
  poster_path: string | null;
}

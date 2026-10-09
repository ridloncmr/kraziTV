/**
 * The owner's corrections to one media item's content facts, and its tags.
 * A null field is uncorrected, so the provider's fact shows through. Kept
 * apart from the match rows, which scans and choices replace wholesale.
 */
export interface MetadataCorrectionTable {
  media_item_id: string;
  title: string | null;
  series_name: string | null;
  season_number: number | null;
  /** A corrected episode is one episode, ending any multi-episode range. */
  episode_number: number | null;
  /** JSON array of the owner's tags and themes; TMDB never sets them. */
  tags: string;
}

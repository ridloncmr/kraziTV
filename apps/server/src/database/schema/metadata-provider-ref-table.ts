/** The provider record a media item's facts came from, and when they were fetched. */
export interface MetadataProviderRefTable {
  media_item_id: string;
  provider: "tmdb";
  /** A movie, or for an episode its TV series. */
  external_kind: "movie" | "tv";
  external_id: number;
  /** When the facts were fetched; TMDB data must be refreshed within six months. */
  fetched_at: number;
  /** Why the last background refresh failed; null after one that answered. */
  refresh_error: string | null;
  /** When expired provider facts were dropped; null while they are current. */
  expired_at: number | null;
}

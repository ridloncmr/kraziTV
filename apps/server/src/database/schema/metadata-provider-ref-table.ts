/** The provider record a media item's facts came from, and when they were fetched. */
export interface MetadataProviderRefTable {
  media_item_id: string;
  provider: "tmdb";
  external_kind: "movie";
  external_id: number;
  /** When the facts were fetched; TMDB data must be refreshed within six months. */
  fetched_at: number;
}

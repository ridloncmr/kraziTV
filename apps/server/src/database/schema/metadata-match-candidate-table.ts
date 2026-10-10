/** One TMDB result offered for an ambiguous item, in TMDB's order. */
export interface MetadataMatchCandidateTable {
  media_item_id: string;
  position: number;
  tmdb_id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
}

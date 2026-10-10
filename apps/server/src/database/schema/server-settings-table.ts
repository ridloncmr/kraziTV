export interface ServerSettingsTable {
  /** Always 1: the table holds exactly one row. */
  id: number;
  /** The owner's TMDB API Read Access Token, or null when none is set (ADR 0013). */
  tmdb_api_key: string | null;
}

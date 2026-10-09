/**
 * The `metadata_corrections` columns that correct a content fact. An item
 * with any of them set counts as corrected, which settles it for scans; tags
 * are the owner's own facts, not a correction, so they are left out.
 */
export const CORRECTED_COLUMNS = [
  "title",
  "series_name",
  "season_number",
  "episode_number",
] as const;

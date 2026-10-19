import type {
  CatalogGenre,
  CatalogGroup,
  CatalogTag,
} from "../http/contracts/collections.js";

/** One cataloged value a picker or filter lists: a TMDB series or franchise, a tag, or a genre. */
export type CatalogOption = CatalogGroup | CatalogTag | CatalogGenre;

/**
 * The value a listed row selects by: its TMDB ID, tag ID, or genre name, as
 * text. A collection criterion and a list filter name the row the same way.
 */
export function optionValue(row: CatalogOption): string {
  if ("tagId" in row) return row.tagId;
  if ("tmdbId" in row) return String(row.tmdbId);
  return row.name;
}

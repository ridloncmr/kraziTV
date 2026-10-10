// TMDB serves posters by width from this base; kraziTV stores only the path.
const POSTER_BASE = "https://image.tmdb.org/t/p/";

/** Builds a poster URL at one of TMDB's widths; the browser loads it from TMDB. */
export function posterUrl(path: string, width: "w92" | "w342"): string {
  return `${POSTER_BASE}${width}${path}`;
}

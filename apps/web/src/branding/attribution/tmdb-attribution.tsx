import tmdbLogo from "./tmdb-logo.svg";

// Where the logo leads: TMDB's site, which the attribution credits.
const TMDB_URL = "https://www.themoviedb.org/";

/**
 * TMDB's logo and the notice its terms require wherever kraziTV shows TMDB
 * facts or asks for a TMDB key. The logo is TMDB's own, unmodified, and kept
 * smaller than kraziTV's branding; it links to TMDB in a new tab so the
 * desktop stays.
 */
export function TmdbAttribution() {
  return (
    <div className="tmdb-attribution">
      <a href={TMDB_URL} target="_blank" rel="noopener">
        <img src={tmdbLogo} alt="TMDB" />
      </a>
      <p>
        This application uses TMDB and the TMDB APIs but is not endorsed,
        certified, or otherwise approved by TMDB.
      </p>
    </div>
  );
}

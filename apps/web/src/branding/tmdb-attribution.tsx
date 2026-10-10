/**
 * TMDB's logo and the notice its terms require wherever kraziTV shows TMDB
 * facts or asks for a TMDB key. The logo is TMDB's own, unmodified, and kept
 * smaller than kraziTV's branding.
 */
export function TmdbAttribution() {
  return (
    <div className="tmdb-attribution">
      <img src="/tmdb-logo.svg" alt="TMDB" />
      <p>
        This application uses TMDB and the TMDB APIs but is not endorsed,
        certified, or otherwise approved by TMDB.
      </p>
    </div>
  );
}

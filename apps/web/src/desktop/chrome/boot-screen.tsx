import { ProgramIcon } from "../../branding/program-icon.js";

/**
 * Stays up while the app asks the server whether this browser is logged in.
 * When the server cannot be reached it says so and offers Retry; the app
 * also retries on its own, so the screen never claims a login state it lacks.
 */
export function BootScreen({
  failed,
  retrying,
  onRetry,
}: {
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <main className="boot-screen" aria-label="kraziTV starting">
      <div>
        <ProgramIcon program="logo" size={120} />
        <h1>
          krazi<span>TV</span>
        </h1>
        <p>Media Server</p>
        {failed ? (
          <div className="boot-failure" role="alert">
            <p>kraziTV can't reach its server.</p>
            <button type="button" onClick={onRetry} disabled={retrying}>
              Retry
            </button>
          </div>
        ) : (
          <div
            className="boot-progress"
            role="status"
            aria-label="Connecting to kraziTV"
          >
            <span className="progress-segments" />
          </div>
        )}
      </div>
      <small>Your television network.</small>
    </main>
  );
}

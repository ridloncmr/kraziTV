import { ProgramIcon } from "../../branding/program-icon.js";

/** Boot makes the initial connection check visible without pretending to start or authenticate the server. */
export function BootScreen() {
  return (
    <main className="boot-screen" aria-label="kraziTV starting">
      <div>
        <ProgramIcon program="logo" size={120} />
        <h1>
          krazi<span>TV</span>
        </h1>
        <p>Media Server</p>
        <div
          className="boot-progress"
          role="status"
          aria-label="Connecting to kraziTV"
        >
          <span />
          <span />
          <span />
        </div>
      </div>
      <small>Your television network.</small>
    </main>
  );
}

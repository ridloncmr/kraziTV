import { LogonBackdrop } from "./logon-backdrop.js";

/**
 * Stands in for the setup screen while the account does not exist yet, so a
 * fresh install never shows a logon screen with no account to log on as.
 */
export function SetupPlaceholder() {
  return (
    <LogonBackdrop label="Set up kraziTV">
      <section className="logon-panel">
        <h1>Welcome to kraziTV</h1>
        <p>
          kraziTV needs its account before anyone can log on. Finish setup to
          continue.
        </p>
      </section>
    </LogonBackdrop>
  );
}

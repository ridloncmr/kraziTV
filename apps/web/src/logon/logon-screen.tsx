import { ProgramIcon } from "../branding/program-icon.js";
import type { AccountProfile, AuthState } from "../http/contracts.js";
import { LogonBackdrop } from "./logon-backdrop.js";
import { AccountTile } from "./account-tile.js";

/**
 * The logon screen for a browser without a session: kraziTV branding on the
 * left and the one account's tile on the right. It decides nothing about
 * access; the server's answer to the login is handed to `onLoggedIn`.
 */
export function LogonScreen({
  account,
  onLoggedIn,
}: {
  account: AccountProfile;
  onLoggedIn: (state: AuthState) => void;
}) {
  return (
    <LogonBackdrop
      label="Log on to kraziTV"
      hint="After you log on, you can change your password or picture in Account Settings."
    >
      <section className="logon-brand">
        <ProgramIcon program="logo" size={84} />
        <h1>
          krazi<span>TV</span>
        </h1>
        <p>To begin, click your user name</p>
      </section>
      <div className="logon-divider" aria-hidden="true" />
      <section className="logon-accounts" aria-label="Users">
        <AccountTile account={account} onLoggedIn={onLoggedIn} />
      </section>
    </LogonBackdrop>
  );
}

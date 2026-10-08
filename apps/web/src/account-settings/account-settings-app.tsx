import { useState } from "react";
import { AccountPicture } from "../branding/avatars/account-picture.js";
import type { AccountProfile } from "../http/contracts.js";
import { ChangeNameView } from "./change-name-view.js";

/** The program's pages: home, or one task, as XP User Accounts pages are. */
type View = "home" | "name" | "picture" | "password";

/**
 * Account Settings: the account's picture and name over three task links.
 * Each task is a view inside this window, not a window dialog, and returns
 * home when it finishes or is cancelled. The account belongs to the app
 * root; a change goes up through `onAccountChanged` and comes back as props.
 */
export function AccountSettingsApp({
  account,
  onAccountChanged,
}: {
  account: AccountProfile;
  onAccountChanged: (account: AccountProfile) => void;
}) {
  const [view, setView] = useState<View>("home");
  const home = () => setView("home");
  if (view === "name")
    return (
      <ChangeNameView
        displayName={account.displayName}
        onChanged={(changed) => {
          onAccountChanged(changed);
          home();
        }}
        onCancel={home}
      />
    );
  if (view === "picture" || view === "password")
    return (
      <div className="program-page account-settings">
        <p className="program-intro">
          Changing your {view} is not available yet.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={home}>
            Back
          </button>
        </div>
      </div>
    );
  return (
    <div className="program-page account-settings">
      <header className="account-settings-header">
        <AccountPicture avatarId={account.avatarId} size={64} />
        <h2>{account.displayName}</h2>
      </header>
      <h3>Pick a task...</h3>
      <ul className="account-settings-tasks">
        <li>
          <button type="button" onClick={() => setView("name")}>
            Change my name
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setView("picture")}>
            Change my picture
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setView("password")}>
            Change my password
          </button>
        </li>
      </ul>
    </div>
  );
}

import { useState } from "react";
import { AccountPicture } from "../branding/avatars/account-picture.js";
import type { AccountProfile } from "../http/contracts.js";
import { ChangeNameView } from "./change-name-view.js";
import { ChangePasswordView } from "./change-password-view.js";
import { ChangePictureView } from "./change-picture-view.js";
import { SetUpTmdbView } from "./set-up-tmdb-view.js";

/** The program's pages: home, or one task, as XP User Accounts pages are. */
type View = "home" | "name" | "picture" | "password" | "tmdb";

/**
 * Account Settings: the account's picture and name over four task links.
 * Each task is a view inside this window, not a window dialog, and returns
 * home when it finishes or is cancelled. The account belongs to the app
 * root; a change goes up through `onAccountChanged` and comes back as props.
 * Each new `tmdbTaskRequest` from the tray opens the Set up TMDB task, and a
 * saved or removed key is reported through `onTmdbKeyChanged`.
 */
export function AccountSettingsApp({
  account,
  onAccountChanged,
  tmdbTaskRequest,
  onTmdbKeyChanged,
}: {
  account: AccountProfile;
  onAccountChanged: (account: AccountProfile) => void;
  tmdbTaskRequest: number;
  onTmdbKeyChanged: () => void;
}) {
  const [view, setView] = useState<View>("home");
  // Adjusted during render, not in an effect, so the task shows on the
  // first paint after the tray asks, whether or not this window was open.
  const [handledRequest, setHandledRequest] = useState(0);
  if (tmdbTaskRequest !== handledRequest) {
    setHandledRequest(tmdbTaskRequest);
    setView("tmdb");
  }
  const home = () => setView("home");
  /** A task's success hands the server's profile to the app root, then goes home. */
  const changed = (changedAccount: AccountProfile) => {
    onAccountChanged(changedAccount);
    home();
  };
  if (view === "name")
    return (
      <ChangeNameView
        displayName={account.displayName}
        onChanged={changed}
        onCancel={home}
      />
    );
  if (view === "picture")
    return (
      <ChangePictureView
        avatarId={account.avatarId}
        onChanged={changed}
        onCancel={home}
      />
    );
  if (view === "password")
    return <ChangePasswordView onDone={home} onCancel={home} />;
  if (view === "tmdb")
    return (
      <SetUpTmdbView
        onDone={() => {
          onTmdbKeyChanged();
          home();
        }}
        onCancel={home}
      />
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
        <li>
          <button type="button" onClick={() => setView("tmdb")}>
            Set up TMDB
          </button>
        </li>
      </ul>
    </div>
  );
}

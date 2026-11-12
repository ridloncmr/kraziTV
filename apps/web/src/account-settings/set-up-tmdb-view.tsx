import { useState } from "react";
import { TmdbAttribution } from "../branding/attribution/tmdb-attribution.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import { WindowDialog } from "../controls/dialogs/window-dialog.js";
import { formText } from "../controls/formatting/form-text.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { useMutation, useResource } from "../http/resources/use-resource.js";
import { lookUpEveryRoot } from "../scan-jobs/every-root-lookup.js";
import { AccountTaskForm } from "./account-task-form.js";
import { keySavedSentence } from "./tmdb-key-words.js";
import { useAccountTask } from "./use-account-task.js";

const KEY_PATH = "/metadata/tmdb-key";

// TMDB's page that shows the owner's API Read Access Token, once signed in.
const TMDB_API_SETTINGS_URL = "https://www.themoviedb.org/settings/api";

/**
 * Account Settings' **Set up TMDB** task: saves, replaces, or removes the
 * owner's TMDB API Read Access Token. The server only ever says whether a key
 * is set, so the box always starts empty. TMDB checks a saved key first; its
 * refusal stays on this page. **Remove** asks first, as every other removal
 * does, and says what the owner keeps. The task says where the free token
 * comes from and links there in a new tab, so an owner sent here by the tray
 * balloon can finish. TMDB's terms require the logo and notice here.
 * A saved key then starts the lookup of every root's outstanding files
 * (spec 0006): the key route stays a key route, so this task asks for it.
 * The key is reported only once that lookup has answered, so the tray never
 * sees the key set while the roots still read as before the lookup started.
 */
export function SetUpTmdbView({
  onKeyChanged,
  onSaved,
  onRemoved,
  onCancel,
}: {
  /**
   * The key is saved and its lookup has answered, so the shell re-reads the
   * roots that now carry the started jobs, and then the key.
   */
  onKeyChanged: () => void;
  /** The key is saved; `confirmation` says what its lookup started. */
  onSaved: (confirmation: string) => void;
  onRemoved: () => void;
  onCancel: () => void;
}) {
  const status = useResource<TmdbKeyStatus>(KEY_PATH);
  const [removing, setRemoving] = useState(false);
  // Whether the lookup a save starts is still being asked for.
  const [lookingUp, setLookingUp] = useState(false);

  /** **Save** sends the trimmed token, never a blank one. */
  function prepare(form: FormData) {
    const apiKey = formText(form, "apiKey").trim();
    return apiKey === ""
      ? { refusal: "Paste your TMDB API Read Access Token." }
      : { body: { apiKey } };
  }

  /**
   * Starts the all-roots lookup once the key is saved, and reports the key
   * saved whatever it answers: a refused lookup stays unsaid, because the
   * tray offers the same lookup again for files still not looked up.
   * The save and this lookup belong to the library, not the window, so
   * closing the window mid-request still starts the lookup and reports the
   * key once the server has answered.
   */
  function lookUpLibrary() {
    setLookingUp(true);
    void lookUpEveryRoot(onKeyChanged).then((lookupCount) => {
      setLookingUp(false);
      onSaved(keySavedSentence(lookupCount));
    });
  }
  const task = useAccountTask(KEY_PATH, "PUT", prepare, lookUpLibrary, {
    outlivesClose: true,
  });

  return (
    <AccountTaskForm
      title="Set up TMDB"
      submitLabel="Save"
      // The page stays busy until the lookup answers, so Save is not sent twice.
      task={{ ...task, pending: task.pending || lookingUp }}
      otherAction={
        status.data?.configured && (
          <button type="button" onClick={() => setRemoving(true)}>
            Remove
          </button>
        )
      }
      onCancel={onCancel}
    >
      <p>
        kraziTV looks up titles, series, and episodes on TMDB with your own TMDB
        API Read Access Token.
      </p>
      <p>
        {status.data === undefined
          ? (status.error?.message ?? "Checking for a TMDB key…")
          : status.data.configured
            ? "A TMDB key is set."
            : "No TMDB key is set."}
      </p>
      <p>
        The token is free: it is the API Read Access Token under{" "}
        <a href={TMDB_API_SETTINGS_URL} target="_blank" rel="noopener">
          Settings, API on themoviedb.org
        </a>
        .
      </p>
      <label>
        API Read Access Token
        <input
          name="apiKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      <TmdbAttribution />
      {removing && (
        <RemoveKeyQuestion
          onRemoved={onRemoved}
          onClose={() => setRemoving(false)}
        />
      )}
    </AccountTaskForm>
  );
}

/**
 * The question **Remove** asks. It owns its removal request, so a refusal
 * shown here closes with it and a reopened question starts clean.
 */
function RemoveKeyQuestion({
  onRemoved,
  onClose,
}: {
  onRemoved: () => void;
  onClose: () => void;
}) {
  const removal = useMutation();
  return (
    <WindowDialog
      title="Remove TMDB key"
      busy={removal.pending}
      onClose={onClose}
    >
      <p>
        Remove the TMDB key? Matches already made stay; new lookups stop until a
        key is set.
      </p>
      <RequestFeedback loading={removal.pending} error={removal.error} />
      <div className="dialog-actions">
        <button
          type="button"
          disabled={removal.pending}
          onClick={() =>
            void removal.run(KEY_PATH, "DELETE", undefined, onRemoved)
          }
        >
          Remove
        </button>
        <button type="button" disabled={removal.pending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </WindowDialog>
  );
}

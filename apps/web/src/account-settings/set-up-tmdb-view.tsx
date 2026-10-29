import { TmdbAttribution } from "../branding/attribution/tmdb-attribution.js";
import { formText } from "../controls/form-text.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { useResource } from "../http/resources/use-resource.js";
import { AccountTaskForm } from "./account-task-form.js";
import { useAccountTask } from "./use-account-task.js";

const KEY_PATH = "/metadata/tmdb-key";

// TMDB's page that shows the owner's API Read Access Token, once signed in.
const TMDB_API_SETTINGS_URL = "https://www.themoviedb.org/settings/api";

/**
 * Account Settings' **Set up TMDB** task: saves, replaces, or removes the
 * owner's TMDB API Read Access Token. The server only ever says whether a key
 * is set, so the box always starts empty. TMDB checks a saved key first; its
 * refusal stays on this page. The task says where the free token comes from
 * and links there in a new tab, so an owner sent here by the tray balloon can
 * finish. TMDB's terms require the logo and notice here.
 */
export function SetUpTmdbView({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const status = useResource<TmdbKeyStatus>(KEY_PATH);

  /** **Remove** deletes the key; **Save** sends the trimmed token, never a blank one. */
  function prepare(form: FormData, action: string) {
    if (action === "remove") return { method: "DELETE", body: undefined };
    const apiKey = formText(form, "apiKey").trim();
    return apiKey === ""
      ? { refusal: "Paste your TMDB API Read Access Token." }
      : { body: { apiKey } };
  }
  const task = useAccountTask(KEY_PATH, "PUT", prepare, onDone);

  return (
    <AccountTaskForm
      title="Set up TMDB"
      submitLabel="Save"
      task={task}
      otherAction={
        status.data?.configured && (
          <button type="submit" value="remove">
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
    </AccountTaskForm>
  );
}

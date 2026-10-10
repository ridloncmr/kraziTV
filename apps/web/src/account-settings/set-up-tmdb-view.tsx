import { TmdbAttribution } from "../branding/tmdb-attribution.js";
import { formText } from "../controls/form-text.js";
import type { TmdbKeyStatus } from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";
import { AccountTaskForm } from "./account-task-form.js";
import { useAccountTask } from "./use-account-task.js";

const KEY_PATH = "/metadata/tmdb-key";

/**
 * Account Settings' **Set up TMDB** task: saves, replaces, or removes the
 * owner's TMDB API Read Access Token. The server only ever says whether a key
 * is set, so the box always starts empty. TMDB checks a saved key first; its
 * refusal stays on this page. TMDB's terms require the logo and notice here.
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

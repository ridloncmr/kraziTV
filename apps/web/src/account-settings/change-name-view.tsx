import { useState, type FormEvent } from "react";
import { displayNameRefusal } from "../account-fields/display-name-refusal.js";
import { formText } from "../controls/form-text.js";
import type { AccountProfile } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";

/**
 * Account Settings' **Change my name** task: one box filled with the current
 * name. It checks the name as setup does, so a refused name never reaches the
 * server, and hands the server's answer to `onChanged`. The server's own
 * refusal stays on this view, so the owner can correct and resend.
 */
export function ChangeNameView({
  displayName,
  onChanged,
  onCancel,
}: {
  displayName: string;
  onChanged: (account: AccountProfile) => void;
  onCancel: () => void;
}) {
  const [refusal, setRefusal] = useState<string>();
  const change = useMutation();
  const message = refusal ?? change.error?.message;

  /** Trims and checks the name before sending, as the server counts it trimmed. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = formText(
      new FormData(event.currentTarget),
      "displayName",
    ).trim();
    const problem = displayNameRefusal(trimmed);
    setRefusal(problem);
    if (problem) return;
    void change.run<AccountProfile>(
      "/account",
      "PATCH",
      { displayName: trimmed },
      onChanged,
    );
  }

  return (
    <form className="program-page account-settings" onSubmit={submit}>
      <h3>Change your name</h3>
      <fieldset disabled={change.pending}>
        <label>
          Type a new name
          <input
            name="displayName"
            defaultValue={displayName}
            autoComplete="name"
            autoFocus
          />
        </label>
        {message && (
          <p className="error-message" role="alert">
            {message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit">Change Name</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

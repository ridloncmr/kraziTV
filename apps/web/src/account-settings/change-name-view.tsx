import { displayNameRefusal } from "../account-fields/display-name-refusal.js";
import { formText } from "../controls/form-text.js";
import type { AccountProfile } from "../http/contracts.js";
import { ProfileChangeForm } from "./profile-change-form.js";

/**
 * Account Settings' **Change my name** task: one box filled with the current
 * name. It checks the name as setup does, so a refused name never reaches the
 * server, and hands the server's answer to `onChanged`.
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
  /** Trims and checks the name before sending, as the server counts it trimmed. */
  function prepare(form: FormData) {
    const trimmed = formText(form, "displayName").trim();
    const refusal = displayNameRefusal(trimmed);
    return refusal ? { refusal } : { change: { displayName: trimmed } };
  }

  return (
    <ProfileChangeForm
      title="Change your name"
      submitLabel="Change Name"
      prepare={prepare}
      onChanged={onChanged}
      onCancel={onCancel}
    >
      <label>
        Type a new name
        <input
          name="displayName"
          defaultValue={displayName}
          autoComplete="name"
          autoFocus
        />
      </label>
    </ProfileChangeForm>
  );
}

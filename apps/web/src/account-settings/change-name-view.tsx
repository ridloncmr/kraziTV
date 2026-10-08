import { displayNameRefusal } from "../account-fields/display-name-refusal.js";
import { formText } from "../controls/form-text.js";
import type { AccountProfile } from "../http/contracts.js";
import { AccountTaskForm } from "./account-task-form.js";
import { useAccountTask } from "./use-account-task.js";

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
    return refusal ? { refusal } : { body: { displayName: trimmed } };
  }
  const task = useAccountTask("/account", "PATCH", prepare, onChanged);

  return (
    <AccountTaskForm
      title="Change your name"
      submitLabel="Change Name"
      task={task}
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
    </AccountTaskForm>
  );
}

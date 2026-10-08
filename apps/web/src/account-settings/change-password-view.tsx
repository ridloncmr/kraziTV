import { useEffect, useRef } from "react";
import { newPasswordRefusal } from "../account-fields/new-password-refusal.js";
import { formText } from "../controls/form-text.js";
import {
  isWrongPassword,
  throttleSeconds,
  throttleWaitMessage,
} from "../password-check/password-check-refusals.js";
import { useThrottleCountdown } from "../password-check/use-throttle-countdown.js";
import { AccountTaskForm } from "./account-task-form.js";
import { useAccountTask } from "./use-account-task.js";

/**
 * Account Settings' **Change my password** task. It checks the new password
 * and its confirmation as setup does, so a refused pair never reaches the
 * server. Every answer stays on this page; none is a `401`, so the desktop
 * stays open. A throttled change counts its wait down and holds back
 * **Change Password** until it ends, as the logon screen does. Success calls
 * `onDone`, whose leaving the page clears it.
 */
export function ChangePasswordView({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  /** Checks the new pair before sending; passwords are never trimmed. */
  function prepare(form: FormData) {
    const newPassword = formText(form, "newPassword");
    const refusal = newPasswordRefusal(newPassword, formText(form, "confirm"));
    return refusal
      ? { refusal }
      : {
          body: {
            currentPassword: formText(form, "currentPassword"),
            newPassword,
          },
        };
  }
  const task = useAccountTask("/account/password", "PUT", prepare, onDone);
  const waitSeconds = useThrottleCountdown(task.error);
  const current = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A wrong current password is retyped from scratch, as on the logon
    // screen; the new pair the owner already typed stays.
    if (!isWrongPassword(task.error) || !current.current) return;
    current.current.value = "";
    current.current.focus();
  }, [task.error]);

  /** Words the server's refusal; a finished countdown says nothing. */
  function describeError(error: Error) {
    if (isWrongPassword(error)) return "The password you typed is incorrect.";
    if (waitSeconds > 0) return throttleWaitMessage(waitSeconds);
    return throttleSeconds(error) > 0 ? undefined : error.message;
  }

  return (
    <AccountTaskForm
      title="Change your password"
      submitLabel="Change Password"
      task={task}
      describeError={describeError}
      submitDisabled={waitSeconds > 0}
      onCancel={onCancel}
    >
      <label>
        Current password
        <input
          ref={current}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          autoFocus
        />
      </label>
      <label>
        New password
        <input name="newPassword" type="password" autoComplete="new-password" />
      </label>
      <label>
        Confirm new password
        <input name="confirm" type="password" autoComplete="new-password" />
      </label>
    </AccountTaskForm>
  );
}

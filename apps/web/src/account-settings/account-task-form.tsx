import type { ReactNode } from "react";
import type { AccountTask } from "./use-account-task.js";

/**
 * The page every Account Settings task shares: a heading, the task's fields,
 * one message line, the submit button, and **Cancel**. Every field is
 * disabled while the task's request is pending. The task's own refusal shows
 * first; otherwise `describeError` words the server's (its own message by
 * default), and may say nothing.
 * `submitDisabled` holds back only the submit button, so the owner can still
 * type or cancel.
 */
export function AccountTaskForm({
  title,
  submitLabel,
  task,
  describeError = (error) => error.message,
  submitDisabled = false,
  onCancel,
  children,
}: {
  title: string;
  submitLabel: string;
  task: AccountTask;
  describeError?: (error: Error) => string | undefined;
  submitDisabled?: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const message = task.refusal ?? (task.error && describeError(task.error));
  return (
    <form className="program-page account-settings" onSubmit={task.submit}>
      <h3>{title}</h3>
      <fieldset disabled={task.pending}>
        {children}
        {message && (
          <p className="error-message" role="alert">
            {message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" disabled={submitDisabled}>
            {submitLabel}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

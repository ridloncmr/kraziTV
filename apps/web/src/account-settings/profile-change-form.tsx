import { useState, type FormEvent, type ReactNode } from "react";
import type { AccountProfile } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";

/** What a task's form asks the server to change, or why it sends nothing. */
type ProfileChange = { change: Partial<AccountProfile> } | { refusal: string };

/**
 * The page every `PATCH /account` task shares: a heading, the task's fields,
 * one message line, the submit button, and **Cancel**. A client refusal never
 * reaches the server; the server's own refusal stays on the page so the owner
 * can correct and resend, and every field is disabled while the change is
 * pending. The server's answer goes to `onChanged`.
 */
export function ProfileChangeForm({
  title,
  submitLabel,
  prepare,
  onChanged,
  onCancel,
  children,
}: {
  title: string;
  submitLabel: string;
  prepare: (form: FormData) => ProfileChange;
  onChanged: (account: AccountProfile) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const [refusal, setRefusal] = useState<string>();
  const change = useMutation();
  const message = refusal ?? change.error?.message;

  /** Sends what the task prepared from its fields, unless the task refused them. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prepared = prepare(new FormData(event.currentTarget));
    if ("refusal" in prepared) {
      setRefusal(prepared.refusal);
      return;
    }
    setRefusal(undefined);
    void change.run<AccountProfile>(
      "/account",
      "PATCH",
      prepared.change,
      onChanged,
    );
  }

  return (
    <form className="program-page account-settings" onSubmit={submit}>
      <h3>{title}</h3>
      <fieldset disabled={change.pending}>
        {children}
        {message && (
          <p className="error-message" role="alert">
            {message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit">{submitLabel}</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

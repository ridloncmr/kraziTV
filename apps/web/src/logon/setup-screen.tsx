import { useEffect, useRef, useState, type FormEvent } from "react";
import { displayNameRefusal } from "../account-fields/display-name-refusal.js";
import { formText } from "../controls/form-text.js";
import { ApiError } from "../http/api-error.js";
import type { AuthState } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import { LogonBackdrop } from "./logon-backdrop.js";

// Mirror the server's setup password rules (spec 0001) so a mistake is caught
// before sending; the server still decides, and its refusal is shown as it comes.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

/**
 * Explains why the server would refuse these fields, or returns undefined.
 * The name counts after trimming; a password is never trimmed.
 */
function setupRefusal(
  name: string,
  password: string,
  confirm: string,
): string | undefined {
  const nameProblem = displayNameRefusal(name);
  if (nameProblem) return nameProblem;
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Your password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  if (password !== confirm) return "The passwords you typed do not match.";
  return undefined;
}

/** True when another browser finished setup first. */
function isAlreadySetUp(error: Error | undefined): boolean {
  return error instanceof ApiError && error.code === "already_set_up";
}

/**
 * The first-run setup screen: one welcome panel that creates the account.
 * Success hands the server's new auth state to the app root, which opens
 * the desktop. A `409` is not this screen's to show: the app root re-reads
 * the auth state through `onAlreadySetUp` and shows the screen it names.
 */
export function SetupScreen({
  onSetUp,
  onAlreadySetUp,
}: {
  onSetUp: (state: AuthState) => void;
  onAlreadySetUp: () => void;
}) {
  const [refusal, setRefusal] = useState<string>();
  const setup = useMutation();
  const nameField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isAlreadySetUp(setup.error)) onAlreadySetUp();
    // The disabled fieldset dropped focus to the page; a refusal brings it
    // back to the first field so the owner can correct and resend.
    else if (setup.error) nameField.current?.focus();
  }, [setup.error, onAlreadySetUp]);
  const message =
    refusal ?? (isAlreadySetUp(setup.error) ? undefined : setup.error?.message);

  /** Checks the fields first, so a refused form never reaches the server. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const displayName = formText(values, "displayName").trim();
    const password = formText(values, "password");
    const problem = setupRefusal(
      displayName,
      password,
      formText(values, "confirm"),
    );
    setRefusal(problem);
    if (problem) return;
    void setup.run<AuthState>(
      "/auth/setup",
      "POST",
      { displayName, password },
      onSetUp,
    );
  }

  return (
    <LogonBackdrop label="Set up kraziTV">
      <section className="logon-panel">
        <h1>Welcome to kraziTV</h1>
        <p>Choose the name and password you will log on with.</p>
        <form className="logon-setup" onSubmit={submit}>
          <fieldset disabled={setup.pending}>
            <label>
              Your name
              <input
                ref={nameField}
                name="displayName"
                autoComplete="name"
                autoFocus
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm password
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <div className="logon-setup-actions">
              <button type="submit">Next</button>
              {message && (
                <p className="logon-balloon" role="alert">
                  {message}
                </p>
              )}
            </div>
          </fieldset>
        </form>
      </section>
    </LogonBackdrop>
  );
}

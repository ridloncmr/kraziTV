import { useEffect, useRef, useState, type FormEvent } from "react";
import { AccountPicture } from "../branding/avatars/account-picture.js";
import { ApiError } from "../http/api-error.js";
import type { AccountProfile, AuthState } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";

/** True when the login's answer was a wrong password, which clears the box. */
function isWrongPassword(error: Error | undefined): boolean {
  return error instanceof ApiError && error.code === "invalid_password";
}

/**
 * The account's tile. Opening it, by click or by Enter on the focused tile,
 * shows the password box and moves focus there. A login's refusal, `401`
 * included, is this tile's answer, shown in a balloon tip; it never leaves
 * the screen.
 */
export function AccountTile({
  account,
  onLoggedIn,
}: {
  account: AccountProfile;
  onLoggedIn: (state: AuthState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const login = useMutation();
  useEffect(() => {
    // The box is disabled while a login runs, so focus returns once it ends.
    if (open && !login.pending) box.current?.focus();
  }, [open, login.pending]);
  useEffect(() => {
    // A wrong password is retyped from scratch, as on XP.
    if (isWrongPassword(login.error)) setPassword("");
  }, [login.error]);

  /** Sends the typed password; the server's new auth state goes to the app root. */
  function submit(event: FormEvent) {
    event.preventDefault();
    void login.run<AuthState>("/auth/login", "POST", { password }, onLoggedIn);
  }

  return (
    <div className={`logon-account${open ? " open" : ""}`}>
      <button
        type="button"
        className="logon-account-tile"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <AccountPicture avatarId={account.avatarId} size={56} />
        <span className="logon-account-name">{account.displayName}</span>
      </button>
      {open && (
        <form className="logon-password" onSubmit={submit}>
          <label>
            Type your password
            <span className="logon-password-row">
              <input
                ref={box}
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={login.pending}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="submit"
                className="logon-go"
                aria-label="Log on"
                disabled={login.pending}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 7h6V3.5L14 8l-5 4.5V9H3z" />
                </svg>
              </button>
            </span>
          </label>
          {login.error && (
            <p className="logon-balloon" role="alert">
              {isWrongPassword(login.error) ? (
                <>
                  <strong>Did you forget your password?</strong> Please type
                  your password again. Be sure to use the correct uppercase and
                  lowercase letters.
                </>
              ) : (
                login.error.message
              )}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

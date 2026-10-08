import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccountPicture } from "../branding/avatars/account-picture.js";
import type { AccountProfile, AuthState } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import {
  isWrongPassword,
  throttleSeconds,
  throttleWaitMessage,
} from "../password-check/password-check-refusals.js";
import { useThrottleCountdown } from "../password-check/use-throttle-countdown.js";

/**
 * What the balloon tip says about the latest refusal, if anything. A finished
 * countdown says nothing, because the box is usable again.
 */
function balloonFor(error: Error | undefined, waitSeconds: number): ReactNode {
  if (!error) return undefined;
  if (isWrongPassword(error))
    return (
      <>
        <strong>Did you forget your password?</strong> Please type your password
        again. Be sure to use the correct uppercase and lowercase letters.
      </>
    );
  if (waitSeconds > 0)
    return (
      <>
        <strong>Please wait.</strong> {throttleWaitMessage(waitSeconds)}
      </>
    );
  return throttleSeconds(error) > 0 ? undefined : error.message;
}

/**
 * The account's tile. Opening it, by click or by Enter on the focused tile,
 * shows the password box and moves focus there. A login's refusal, `401`
 * included, is this tile's answer, shown in a balloon tip; it never leaves
 * the screen. A throttled login counts its wait down and keeps the box
 * disabled until it ends.
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
  const waitSeconds = useThrottleCountdown(login.error);
  const disabled = login.pending || waitSeconds > 0;
  useEffect(() => {
    // The box is disabled while a login runs or a wait counts down, so focus
    // returns once it can be typed in again.
    if (open && !disabled) box.current?.focus();
  }, [open, disabled]);
  useEffect(() => {
    // A wrong password is retyped from scratch, as on XP.
    if (isWrongPassword(login.error)) setPassword("");
  }, [login.error]);

  /** Sends the typed password; the server's new auth state goes to the app root. */
  function submit(event: FormEvent) {
    event.preventDefault();
    void login.run<AuthState>("/auth/login", "POST", { password }, onLoggedIn);
  }

  const balloon = balloonFor(login.error, waitSeconds);

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
                disabled={disabled}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="submit"
                className="logon-go"
                aria-label="Log on"
                disabled={disabled}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 7h6V3.5L14 8l-5 4.5V9H3z" />
                </svg>
              </button>
            </span>
          </label>
          {balloon && (
            <p className="logon-balloon" role="alert">
              {balloon}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

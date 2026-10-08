import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccountPicture } from "../branding/avatars/account-picture.js";
import { ApiError } from "../http/api-error.js";
import type { AccountProfile, AuthState } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";

/** True when the login's answer was a wrong password, which clears the box. */
function isWrongPassword(error: Error | undefined): boolean {
  return error instanceof ApiError && error.code === "invalid_password";
}

/**
 * The whole seconds a throttled login must wait, from the `429` envelope's
 * `retryAfterSeconds`. Zero when the answer is not a throttle or carries no
 * usable wait: then the server's message shows and the box stays usable,
 * because the server refuses an early try anyway.
 */
function throttleSeconds(error: Error | undefined): number {
  if (!(error instanceof ApiError) || error.code !== "too_many_attempts")
    return 0;
  const seconds = error.details.retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : 0;
}

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
        <strong>Please wait.</strong> Too many wrong passwords were typed. You
        can try again in {waitSeconds}{" "}
        {waitSeconds === 1 ? "second" : "seconds"}.
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
  const [waitSeconds, setWaitSeconds] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const login = useMutation();
  const disabled = login.pending || waitSeconds > 0;
  useEffect(() => {
    // The box is disabled while a login runs or a wait counts down, so focus
    // returns once it can be typed in again.
    if (open && !disabled) box.current?.focus();
  }, [open, disabled]);
  useEffect(() => {
    // A wrong password is retyped from scratch, as on XP.
    if (isWrongPassword(login.error)) setPassword("");
    setWaitSeconds(throttleSeconds(login.error));
  }, [login.error]);
  useEffect(() => {
    // One tick per second; unmounting or a new answer clears the pending one.
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((left) => left - 1), 1_000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

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

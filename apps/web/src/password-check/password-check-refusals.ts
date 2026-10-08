import { ApiError } from "../http/api-error.js";

// How the web app reads the server's refusal of a password check. The logon
// screen and Account Settings both check a password against the same throttle
// (`429 too_many_attempts`), so they read its answers through this one copy.

/** True when the server's answer was a wrong password, which clears the box. */
export function isWrongPassword(error: Error | undefined): boolean {
  return error instanceof ApiError && error.code === "invalid_password";
}

/**
 * The whole seconds a throttled check must wait, from the `429` envelope's
 * `retryAfterSeconds`. Zero when the answer is not a throttle or carries no
 * usable wait: then the server's message shows and the form stays usable,
 * because the server refuses an early try anyway.
 */
export function throttleSeconds(error: Error | undefined): number {
  if (!(error instanceof ApiError) || error.code !== "too_many_attempts")
    return 0;
  const seconds = error.details.retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : 0;
}

/** Says how long a throttled owner still waits, in the words both screens use. */
export function throttleWaitMessage(waitSeconds: number): string {
  return `Too many wrong passwords were typed. You can try again in ${waitSeconds} ${
    waitSeconds === 1 ? "second" : "seconds"
  }.`;
}

import type { FastifyBaseLogger } from "fastify";

/** What a logged-out browser may know about the account: enough to draw its tile. */
export interface AccountProfile {
  displayName: string;
  avatarId: string;
}

/** Whether the server still needs setup, and whether a request's session is valid. */
export interface AuthState {
  setupRequired: boolean;
  account: AccountProfile | null;
  authenticated: boolean;
}

/** Validated setup fields; the routes trim and bound them before the service sees them. */
export interface SetUpInput {
  displayName: string;
  password: string;
}

/** Validated profile changes; an absent field keeps its current value. */
export interface ProfileUpdate {
  displayName?: string;
  avatarId?: string;
}

/** How long a reissued session cookie should live. */
export interface IssuedSessionLifetime {
  maxAgeSeconds: number;
}

/** A new session's token, which leaves the server only in the cookie, and the cookie's lifetime. */
export interface IssuedSession extends IssuedSessionLifetime {
  token: string;
}

export type SetUpResult =
  { kind: "created"; session: IssuedSession } | { kind: "already_set_up" };

export type LogInResult =
  | { kind: "logged_in"; session: IssuedSession }
  | { kind: "setup_required" }
  | { kind: "invalid_password" }
  | { kind: "too_many_attempts"; retryAfterSeconds: number };

export type ResetPasswordResult =
  { kind: "reset" } | { kind: "setup_required" };

/** How the auth gate must treat one request. */
export type Authentication =
  // `renewal` is present only when this request extended the session, so
  // the gate reissues the cookie it already carries.
  | { kind: "authenticated"; renewal?: IssuedSessionLifetime }
  | { kind: "unauthenticated" }
  | { kind: "setup_required" };

/**
 * The one question the auth gate asks. Kept narrow so the test stand-in that
 * signs every request in must change whenever the gate's needs do.
 */
export interface RequestAuthenticator {
  /**
   * Classifies a request by the session token its cookie carries, if any.
   * `log` reports best-effort work, such as a renewal that could not write.
   */
  authenticate(
    token: string | undefined,
    log: Pick<FastifyBaseLogger, "warn">,
  ): Promise<Authentication>;
}

/** What a logged-out browser may know about the account: enough to draw its tile. */
interface AccountProfile {
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

/** A new session's token, which leaves the server only in the cookie, and the cookie's lifetime. */
export interface IssuedSession {
  token: string;
  maxAgeSeconds: number;
}

export type SetUpResult =
  { kind: "created"; session: IssuedSession } | { kind: "already_set_up" };

export type LogInResult =
  | { kind: "logged_in"; session: IssuedSession }
  | { kind: "setup_required" }
  | { kind: "invalid_password" }
  | { kind: "too_many_attempts"; retryAfterSeconds: number };

/** How the auth gate must treat one request. */
export type Authentication =
  | { kind: "authenticated" }
  | { kind: "unauthenticated" }
  | { kind: "setup_required" };

/**
 * The one question the auth gate asks. Kept narrow so the test stand-in that
 * signs every request in must change whenever the gate's needs do.
 */
export interface RequestAuthenticator {
  /** Classifies a request by the session token its cookie carries, if any. */
  authenticate(token: string | undefined): Promise<Authentication>;
}

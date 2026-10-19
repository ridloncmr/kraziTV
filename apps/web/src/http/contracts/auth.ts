// Wire shapes of the account and its session state.
/** The account's public profile: enough for a logged-out browser to draw its user tile. */
export interface AccountProfile {
  displayName: string;
  avatarId: string;
}
/** What `GET /auth/state`, `/auth/login`, and `/auth/setup` answer; it decides the screen. */
export interface AuthState {
  setupRequired: boolean;
  account: AccountProfile | null;
  authenticated: boolean;
}

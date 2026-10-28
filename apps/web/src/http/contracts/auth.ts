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
  /**
   * Only `GET /auth/state` sends it: null when the server accepts writes from
   * the page's own address, otherwise what works instead. `open` names the
   * public base URL; `configure` means it names the server's own computer
   * while this browser is elsewhere, so no link would work.
   */
  wrongAddress?: WrongAddress | null;
}

/** The advice `GET /auth/state` gives a page whose address cannot write. */
export type WrongAddress =
  { kind: "open"; url: string } | { kind: "configure" };

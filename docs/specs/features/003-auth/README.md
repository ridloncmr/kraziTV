# Auth Feature

Status: In Development

This feature locks kraziTV's administration behind one account. The server
denies every request without a session, the web app opens on an XP-style logon
screen, and the account owner can change their password, display name, and
picture. Plex keeps tuning without logging in.

[ADR 0012](../../../adrs/0012-first-party-session-auth.md) defines the model:
first-party sessions in the server, one account, a deny-by-default auth gate,
and public provider endpoints.

## Related Specs

Specs are listed in delivery order. Each spec's status is the `Status:` line at
the top of the spec.

| Spec                                                              | Description                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| [0001-accounts-and-sessions](specs/0001-accounts-and-sessions.md) | Account setup, login, sessions, the auth gate, and password recovery |
| [0002-logon-screen](specs/0002-logon-screen.md)                   | XP-style setup and logon screens and the web app's 401 handling      |
| [0003-account-settings](specs/0003-account-settings.md)           | Changing password, display name, and built-in avatar                 |

## Out Of Scope

- OAuth, OpenID Connect, and external identity providers.
- More than one account, roles, and permissions.
- Multi-factor authentication and email password reset.
- Exposing kraziTV to the internet, including TLS termination.
- Hiding channel streams and guide data from the local network.

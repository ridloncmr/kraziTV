# Accounts And Sessions

Status: Implemented

This spec gives kraziTV one account, password login, sliding sessions, and a
deny-by-default auth gate on the server, as
[ADR 0012](../../../../adrs/0012-first-party-session-auth.md) decides. It uses
**account**, **session**, **auth gate**, and **public route** as `GLOSSARY.md`
defines them.

## Problem

Every server route is open. Anyone who can reach the server's port can change
the catalog, channels, and programming, and browse the server's folders
through the media-root folder picker. Hiding the web app would not help,
because the API answers directly.

## Goals

- Create the one account on first run, with no default password.
- Log in with a password and receive a session cookie.
- Keep the session alive for 30 days after the last use.
- Reject every non-public request without a valid session.
- Keep Plex discovery, lineup, guide, and streams working without a session.
- Slow down password guessing.
- Recover a forgotten password from the server host.

## Non-goals

- More than one account, roles, or per-route permissions.
- OAuth, OpenID Connect, JWTs, API keys, or tokens for scripts.
- Multi-factor authentication or email reset.
- TLS. kraziTV stays on the local network; see the feature's out-of-scope list.
- The logon UI ([0002](0002-logon-screen.md)) and account settings
  ([0003](0003-account-settings.md)).

## User-Facing Behavior

This spec delivers the API. Users see it through [0002](0002-logon-screen.md).

- Before setup, every gated route answers `401` with code `setup_required`.
  After setup, a request without a valid session answers `401` with code
  `unauthenticated`.
- `kraziTV reset-password` (an npm script in `apps/server`) run on the server
  host prompts for a new password, replaces the account's password, and ends
  every session. It does not need the old password, because only someone with
  shell access to the host can run it.

## Technical Behavior

### Auth routes

All are public routes. Request and response bodies are JSON.

| Route               | Behavior                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/state`   | Returns `{ setupRequired, account }`. `account` is `{ displayName, avatarId }` when an account exists, otherwise `null`, so the logon screen can draw the user tile. Includes `authenticated` when the request carries a valid session. |
| `POST /auth/setup`  | Creates the account from `{ displayName, password }` and logs in. Answers `409 already_set_up` once an account exists.                                                                                                                  |
| `POST /auth/login`  | Checks `{ password }` against the one account. On success creates a session and sets the cookie. On failure answers `401 invalid_password`.                                                                                             |
| `POST /auth/logout` | Deletes the request's session, if any, and clears the cookie. Always succeeds.                                                                                                                                                          |

Login takes only a password, because there is one account. The display name is
not a login credential.

### Passwords

- Hashed with `crypto.scrypt`, a 16-byte random salt, and stored with its cost
  parameters so they can be raised later without invalidating old hashes.
- Compared with `crypto.timingSafeEqual`.
- At least 8 characters, at most 256. No other composition rules.

### Sessions

- A session token is 32 random bytes, base64url-encoded, sent once in the
  cookie and stored only as its SHA-256 hash.
- The cookie is `krazitv_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`,
  with `Max-Age` matching the session's expiry. It is `Secure` only when
  `PUBLIC_BASE_URL` is `https`.
- A session expires 30 days after its last extension. An authenticated request
  at least one day after the last extension moves `expiresAt` to 30 days from
  now and reissues the cookie, so an active session never expires and the
  sessions table is not written on every request.
- Expired sessions are rejected and deleted when encountered; startup also
  deletes every expired session.

### Auth gate

- One Fastify `onRequest` hook registered before every route. It checks the
  request's route against the public route list; anything else needs a valid
  session.
- The public route list is fixed in one file:

  | Route                                                                                  | Why public                      |
  | -------------------------------------------------------------------------------------- | ------------------------------- |
  | `GET /health`                                                                          | Startup and liveness checks     |
  | `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`         | A logged-out browser needs them |
  | `GET /discover.json`, `GET /lineup.json`, `GET /lineup_status.json`, `GET /device.xml` | Plex HDHomeRun tuner            |
  | `GET /plex/xmltv.xml`                                                                  | Plex guide                      |
  | `GET /channels/:id/stream`                                                             | Plex tunes channels             |

- `GET /plex/setup` stays gated: it is admin information, not a Plex call.
- Matching uses Fastify's matched route pattern and method, never the raw URL,
  so a path with extra slashes or encoding cannot slip past.
- Unknown routes answer `404` only after the gate, so a logged-out client
  cannot probe which admin routes exist.

### Cross-site requests

- CORS is credentialed (`credentials: true`) for the configured web origins.
- A request with a method other than `GET` or `HEAD` whose `Origin` header is
  present and is neither the public base URL's origin nor a configured CORS
  origin answers `403 forbidden_origin`. Browsers always send `Origin` on such
  requests, and only browsers carry the session cookie, so a request without
  one is not a cross-site forgery. With `SameSite=Strict` this blocks
  cross-site request forgery.

### Login throttling

- Failed logins are counted in memory. After 5 consecutive failures, each
  further attempt must wait, doubling from 1 second up to 5 minutes. An
  attempt during the wait answers `429 too_many_attempts` with
  `retryAfterSeconds` and does not check the password.
- A successful login resets the count. A server restart resets it too, which is
  acceptable on a home network.

## Data Model Impact

A new migration adds:

| Table      | Columns                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `accounts` | `id`, `displayName`, `avatarId`, `passwordHash`, `createdAt`, `updatedAt`       |
| `sessions` | `id`, `accountId` (FK, cascade), `tokenHash` (unique), `createdAt`, `expiresAt` |

Times are integer milliseconds ([ADR 0007](../../../../adrs/0007-integer-millisecond-time.md)).
At most one `accounts` row exists; setup inserts it inside a write transaction
that first checks the table is empty, so two concurrent setups cannot both
succeed. `avatarId` defaults to the first built-in avatar
([0003](0003-account-settings.md)).

## Architecture Boundaries

- The code lives in `apps/server/src/auth/`, grouped into capability folders as
  ADR 0010 requires (for example `routes/`, `sessions/`, `passwords/`, `gate/`).
- Auth is a server concern. kraziBrain, SignalPackager, and the `media`,
  `signal`, and `process` packages know nothing about it.
- Provider adapters stay public. Do not add session checks to provider routes.

kraziTV check: no effect on the schedule, playout timeline, channel state,
kraziBrain, or SignalPackager. Provider adapters are affected only by being
named on the public route list.

## Open Questions

- Can Plex's tuner address carry a path secret, such as
  `http://host:3000/t/<token>`? If so, a later spec can take provider
  endpoints off the public list. Research belongs in
  `docs/knowledge_base/`.
- Should the gate also refuse requests whose `Host` is not a configured name,
  to blunt DNS rebinding? Sessions already require the cookie, so this only
  matters for public routes.

## Acceptance Criteria

- With no account, every gated route answers `401 setup_required`, and
  `POST /auth/setup` creates the account, sets the cookie, and answers once;
  a second setup answers `409 already_set_up`.
- After setup, every gated route answers `401 unauthenticated` without a
  cookie and succeeds with a valid one.
- A test enumerates every registered route and fails if a route is neither
  public nor gated as expected, so a new route cannot ship unprotected by
  accident.
- Every listed public route answers without a cookie, and Plex acceptance tests
  pass unchanged.
- A wrong password answers `401 invalid_password`; the sixth consecutive
  failure answers `429` with `retryAfterSeconds`.
- A session used again after more than a day moves its expiry to 30 days
  out; an unused session stops working after 30 days.
- Logout deletes the session; the old cookie then answers `401`.
- A gated `POST` with a foreign `Origin` answers `403 forbidden_origin`.
- The database holds no plaintext password or session token.
- `reset-password` replaces the password and ends every session.

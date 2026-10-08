# 0012 First-Party Session Authentication

## Status

Proposed on 2026-10-07.

## Context

Every kraziTV HTTP route is open. kraziTV is meant to stay on a home network,
but anyone on that network, or anyone who forwards its port, can add media
roots, delete channels, and browse server folders.

kraziTV has one server and one first-party web app. No other application must
trust a kraziTV login, no third party calls its API, and no external identity
provider is planned. OAuth 2.0 and OpenID Connect servers such as Duende
IdentityServer solve token issuance and delegation across several clients and
APIs. kraziTV has neither problem, so a token server would add flows, keys, and
token lifetimes with nothing to protect them from.

Plex cannot authenticate. Its HDHomeRun tuner fetches discovery, lineup, guide,
and stream URLs without credentials
([ADR 0002](0002-plex-hdhomerun-tuner-emulation.md)), so those routes must
answer without a session.

## Decision

- kraziTV authenticates with a **session**: a password login creates a
  server-side session row, and the browser carries its random token in an
  `HttpOnly`, `SameSite=Strict` cookie. Do not use OAuth, OpenID Connect,
  JWTs, scopes, or claims.
- Authentication lives in the server app as one `auth/` domain with its own
  tables and migrations in the existing SQLite database. Do not add a separate
  identity app, package, or database.
- kraziTV has exactly one **account**. There are no roles or permissions: a
  valid session may do everything the API offers.
- The **auth gate** denies every route by default. A request without a valid
  session gets `401` unless its route is on the fixed **public route** list.
  New routes are gated without opting in.
- Public routes are the health check, the auth routes a logged-out browser
  needs, and the provider endpoints Plex calls: tuner discovery, lineup,
  device, guide, and channel streams. Anyone on the network can watch channels
  and read guide data. Only the account can change anything.
- Passwords are hashed with Node's built-in `crypto.scrypt` and a random
  per-password salt. Session tokens are stored only as SHA-256 hashes.
- Sessions slide: each authenticated request at least one day after the last
  extension renews the expiry to 30 days from that request.
- A forgotten password is reset from the server host with a CLI command, never
  over HTTP.

## Consequences

- Locking down the server locks down the web app. The browser holds no
  authority the server does not check on every request.
- Adding a provider endpoint means adding it to the public route list. Forgetting
  breaks the provider instead of exposing the API.
- Channels and guide data stay viewable on the LAN. Hiding them requires a
  provider-URL secret, which needs research into what Plex accepts; a later
  ADR would amend this one.
- Adding more accounts later needs a decision on whether accounts differ in
  power. This ADR does not reserve a role model for it.
- In development the web app (`127.0.0.1:5173`) and server (`127.0.0.1:3000`)
  are different origins but the same site, so the cookie is sent when the web
  client fetches with credentials and the server allows credentialed CORS.

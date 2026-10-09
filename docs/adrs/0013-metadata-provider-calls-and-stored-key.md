# 0013 Metadata Provider Calls And The Stored TMDB Key

## Status

Accepted on 2026-10-08.

## Context

Until now kraziTV made no outbound calls: Plex calls kraziTV, never the
reverse ([ADR 0002](0002-plex-hdhomerun-tuner-emulation.md)). Content metadata
enrichment
([programming spec 0001](../specs/features/002-programming/specs/0001-metadata-enrichment.md))
adds the first: lookups against TMDB, a **metadata provider**, using the
user's own API Read Access Token.

That token is the first third-party secret kraziTV stores. Unlike a password
or session token ([ADR 0012](0012-first-party-session-auth.md)), it must be
sent to TMDB as `Authorization: Bearer`, so it cannot be hashed. Encrypting it
would need a second key kept on the same host as the database, which protects
nothing from anyone who can read that host.

A slow or unreachable third party must never stall a scan's commit, the
schedule, or a broadcast signal.

## Decision

- Only `packages/media` calls a metadata provider. The TMDB client lives in
  `packages/media/src/tmdb/`, stays persistence-free, and maps responses to
  normalized values. `apps/server` composes it, stores results, and owns the
  key. kraziBrain, SignalPackager, and provider adapters never call TMDB or
  import its client.
- The client uses Node's built-in `fetch`, injected so tests replace it. Add no
  HTTP client dependency.
- Every call has a per-request timeout and honors the caller's abort signal. A
  timeout, network error, or `5xx` is a reported failure, never a thrown scan
  failure. No outbound call runs while holding write authority.
- The client calls only TMDB's fixed HTTPS API base. It sends search terms
  derived from path hints, never file paths or other catalog data.
- The server stores the token as-is in a single-row server settings table in
  the existing SQLite database, outside `accounts`. Its routes are gated; no
  route, log line, error message, or stored diagnostic ever contains it. It
  leaves the server only in the `Authorization` header to TMDB.
- The token is set through the web app, not an environment variable.
  `TMDB_API_KEY` is read only by the opt-in integration suite.

## Consequences

- Anyone who can read the database file can read the token. Protecting the
  file is the host owner's job, and a leaked token is revoked from the user's
  own TMDB account. Database backups carry the token.
- A second metadata provider adds a sibling client in `packages/media`; this
  ADR reserves no provider registry for it.
- Outbound calls are bounded and cancellable, so TMDB outages degrade
  enrichment only and never broadcasting.

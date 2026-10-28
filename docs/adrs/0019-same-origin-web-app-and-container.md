# 0019 The Server Serves The Built Web App, And One Image Holds Everything

## Status

Accepted on 2026-10-28. Settles the production hosting left open in
[spec 0008](../specs/features/001-mvp/specs/0008-web-admin.md). Keeps
[ADR 0012](0012-first-party-session-auth.md)'s fixed public route list and
cross-site write check, and widens the check only to loopback spellings of
an allowed origin.

## Context

Installing kraziTV meant running two servers: Fastify for the API and Vite
for the web app, with CORS between them. Nothing served the built web app,
and there was no image with FFmpeg in it. Owners comparing kraziTV with
ErsatzTV expect one process on one address.

Serving the web app from the API's own origin exposes ADR 0012's write
check to owners directly: it accepts writes only from the public base URL's
origin and the CORS list. An owner who opens `http://localhost:3000` while
the public base URL says `127.0.0.1`, or who opens the server's LAN address
before setting `PUBLIC_BASE_URL`, could not even set up the account.

## Decision

- **Fastify serves the built web app when one exists.** `npm run build`
  writes `apps/web/dist`; the server finds it beside its own code and
  serves `GET /` (`index.html`, never cached) and `GET /assets/*`
  (content-hashed files, cached for a year). Without a build the server is
  API-only, as it is beside `vite dev`. The production web app already
  calls the API same-origin, so it needs no CORS.
- **The build is only `index.html` and `assets/`.** Images live in `src/`
  and are imported, so Vite hashes or inlines them. The two web app routes
  join the public route list as fixed entries. A catch-all route would
  answer `404` for unknown paths to logged-out clients, letting them tell
  admin routes from nonsense, which ADR 0012 forbids.
- **Loopback spellings of the public base URL are one origin.** When its
  host is `127.0.0.1`, `localhost`, or `[::1]`, the other two spellings with
  the same scheme and port are allowed too. It is kraziTV's own address, so
  each spelling names kraziTV. CORS entries get no aliases: the session
  cookie's `SameSite` ignores ports, so `localhost:5173` may be another
  app's dev server that a browser treats as same-site.
- **The logon screen sends a browser on the wrong address to the right
  one.** The boot read sends the page's own origin as
  `GET /auth/state?origin=`. When the gate would refuse that origin's
  writes, the answer's `wrongAddress` is `open` with the public base URL,
  or `configure` when that URL is loopback and the page is not, since a
  link to another machine's loopback goes nowhere. The web app shows a
  link, or asks for `PUBLIC_BASE_URL`, instead of setup or logon. It is
  advice only; every write is still judged by its own `Origin` header.
- **The page refuses framing.** `GET /` sends
  `content-security-policy: frame-ancestors 'none'` and `nosniff`.
- **One Docker image holds the server, the web app, and FFmpeg.** It builds
  on Debian trixie, whose FFmpeg 7.1 supports `-readrate_initial_burst`
  ([ADR 0018](0018-join-backlog.md)); bookworm's 5.1 does not. It binds
  `0.0.0.0:3000`, keeps data in the `/data` volume, runs as `node`, and
  includes a font for the filler screen.
- **Settings may come from a `.env` file at the repo root**, read at
  startup; variables already in the environment win.

## Consequences

- An installed kraziTV is one process on one port. `vite dev` with CORS
  remains the development setup.
- Owners must open kraziTV at its public base URL, or a loopback spelling
  of it. Using it from another device means setting `PUBLIC_BASE_URL`,
  which Plex on another device needs anyway.
- A new file type in the web build must land under `assets/`, or it is not
  served.
- The image is about 750 MB, mostly FFmpeg's libraries.
- Behind a TLS-terminating proxy the public base URL is the proxy's
  `https` address; cookies are then `Secure`, as ADR 0012 already decides.

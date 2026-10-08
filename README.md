# kraziTV

kraziTV is a deterministic, stateful television network simulator for local media libraries. Its first provider target is Plex, with Jellyfin support planned after the Plex-focused MVP.

Channels behave as if they are continuously broadcasting. When a viewer tunes in, they join the current program at its wall-clock position instead of starting it from the beginning.

## Architecture

kraziTV separates four responsibilities:

- **kraziBrain** decides what plays, when it plays, and why.
- **Channel stream workers** operate one shared broadcast signal per watched channel.
- **SignalPackager** turns selected media into a continuous stream.
- **Provider adapters** expose channels, streams, and guide data to Plex and future providers.

Provider-specific behavior must not leak into scheduling. FFmpeg command construction belongs to SignalPackager, not kraziBrain.

```text
Configuration and exposure:

Web Admin ----> kraziBrain ---- schedule / guide ----> provider adapter ----> Plex / Jellyfin

Tune and stream:

Plex / Jellyfin ---- tune ----> provider-neutral stream endpoint ----> channel stream worker
kraziBrain ---- selected playout ------------------------------------> channel stream worker
                                                                         |
                                                                         v
                                                                  SignalPackager
                                                                         |
                                                                         v
                                                             shared MPEG-TS signal
```

Provider adapters expose tuner metadata, guide data, and stream URLs. Stream bytes flow through the provider-neutral endpoint and shared channel worker, not through the provider adapter.

The guide-facing **schedule** is separate from the **playout timeline** containing everything actually transmitted. **Channel state** identifies the current playout item and join-in-progress offset at a given time.

## Project Structure

```text
apps/
  server/      Fastify API and route wiring
  web/         React administration UI
packages/
  krazi-brain/ kraziBrain: scheduling, channel rules, and playout decisions
  media/       discovery, ffprobe, and source metadata
  process/     child-process spawning shared by media and signal
  signal/      active channel workers, FFmpeg lifecycle, and stream packaging
  plex/        HDHomeRun-compatible and XMLTV formatting
docs/
  specs/       feature goals and behavior specifications
  adrs/        accepted architecture decisions
  implementation_plan/  milestone and task sequencing
  knowledge_base/       research and operational notes
```

## Current MVP

The MVP goal and its vertical-slice specs live in [`docs/specs/features/001-mvp/`](docs/specs/features/001-mvp/README.md). Detailed behavior belongs to the numbered specs in that feature folder; those specs are authoritative when this overview and a feature detail differ.

The MVP proves one complete Plex loop: configure local media and a channel, materialize deterministic guide data, join the channel in progress, and keep Plex playing across a real two-file boundary.

Commercial insertion, advanced programming rules, Jellyfin, and production packaging are deferred.

> **Security note:** Administration needs the one account's session
> ([ADR 0012](docs/adrs/0012-first-party-session-auth.md)). The health check,
> the auth routes, and the Plex tuner, guide, and stream endpoints stay public, so
> anyone who can reach the server can watch channels and read guide data. kraziTV
> serves plain HTTP; keep it on a trusted network.

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer

Common commands:

```bash
npm install
npm run dev
npm run dev:web
npm run typecheck
npm test
npm run build
npm run format
npm run test:ffprobe
npm run reset-password
```

`npm run test:ffprobe` is an opt-in check of media probing against real
ffprobe. It needs `ffmpeg` and `ffprobe` on `PATH`, or `FFMPEG_PATH` and
`FFPROBE_PATH` set to their executables, and it fails rather than skips when
they are missing. `npm test` and CI do not run it.

`npm run dev` starts the API at `http://127.0.0.1:3000`. During development the
Web Admin runs separately: start it with `npm run dev:web` in a second terminal.

`npm run reset-password` sets a new password for the kraziTV account when the
old one is forgotten. Run it in an interactive terminal on the server host, with
the same `KRAZITV_DATA_DIR` the server uses; it prompts twice without echoing,
replaces the password, and logs every browser out. The server may keep running.

The Web Admin at `http://127.0.0.1:5173` is an XP-inspired kraziTV desktop.
Open Media Library to add and scan server paths, Collections to arrange media,
and My Channels to configure channel identity and programming. Program Guide
and Live Monitor display backend-computed state; Plex Setup supplies the
server-configured tuner and XMLTV URLs. Programs are reachable through desktop
shortcuts or Start; title bars support pointer dragging and arrow-key movement.
Minimized programs retain form drafts and remain on the taskbar.

Set `VITE_API_BASE_URL` when the browser should use a different API origin.
Development defaults to `http://127.0.0.1:3000`; a production build defaults to
same-origin requests. Serving the built UI is still deployment/packaging work.
For Chromium verification, run `npx playwright install chromium` and
`npm run test:browser --workspace @krazitv/web`. This opt-in suite uses real
Fastify routes and SQLite, with the existing controlled probe adapter, and writes
desktop/guide screenshots under `data/`. It does not tune Plex or test FFmpeg.

Browser CORS access defaults to the local Web UI at
`http://127.0.0.1:5173`. Set `CORS_ORIGINS` to a comma-separated list of exact
allowed origins when the UI is served elsewhere. CORS is not authentication and
does not make a network-exposed API safe.

CI runs install, formatting, typecheck, test, and build checks on every pull
request and on pushes to `main`. Automated tests cover the local media catalog
end to end (media roots, discovery, probing through a controlled double, scans,
and catalog queries against SQLite), scheduling, playout, Plex formatting,
shared-signal runtime primitives, server configuration, and browser interaction
contracts. Real Plex compatibility and external-binary suites remain separate.

## License

kraziTV is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and
redistribute it for noncommercial purposes. Commercial use is not licensed.

Third-party material retains its own license and attribution notices. In
particular, the adapted agent skills are covered by the complete MIT notice in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the attribution documented
in [`.agents/README.md`](.agents/README.md).

## Documentation

- [`docs/specs/`](docs/specs/README.md) defines product behavior and spec statuses.
- [`docs/adrs/`](docs/adrs/README.md) records architecture decisions.
- [`docs/implementation_plan/`](docs/implementation_plan/README.md) tracks build order.
- [`docs/knowledge_base/`](docs/knowledge_base/README.md) holds research and operational references.
- [`AGENTS.md`](AGENTS.md) defines project boundaries and shared vocabulary for AI agents.
- [`.agents/README.md`](.agents/README.md) documents agent skills, roles, and harness adapters.

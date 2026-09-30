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
  core/        scheduling, channel rules, and playout decisions
  media/       discovery, ffprobe, and source metadata
  signal/      active channel workers, FFmpeg lifecycle, and stream packaging
  plex/        HDHomeRun-compatible and XMLTV formatting
docs/
  specs/       feature goals and behavior specifications
  adrs/        accepted architecture decisions
  implementation_plan/  milestone and task sequencing
  knowledge_base/       research and operational notes
```

## Current MVP

The accepted MVP goal and its vertical-slice status table live in [`docs/specs/features/001-mvp/`](docs/specs/features/001-mvp/README.md). Detailed behavior belongs to the numbered specs in that feature folder; those specs are authoritative when this overview and a feature detail differ.

The MVP proves one complete Plex loop: configure local media and a channel, materialize deterministic guide data, join the channel in progress, and keep Plex playing across a real two-file boundary.

Commercial insertion, advanced programming rules, Jellyfin, authentication, and production packaging are deferred.

> **Security warning:** The MVP has no authentication. Keep the API bound to the
> default `127.0.0.1` unless every client on the network is trusted. A LAN-exposed
> instance allows unauthenticated access to mutable administration APIs, including
> local-media scan capabilities that accept absolute filesystem paths.

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer

Common commands:

```bash
npm install
npm run dev
npm run dev --workspace @krazitv/web
npm run typecheck
npm test
npm run build
npm run format
npm run test:ffprobe
```

`npm run test:ffprobe` is an opt-in check of media probing against real
ffprobe. It needs `ffmpeg` and `ffprobe` on `PATH`, or `FFMPEG_PATH` and
`FFPROBE_PATH` set to their executables, and it fails rather than skips when
they are missing. `npm test` and CI do not run it.

`npm run dev` starts the API at `http://127.0.0.1:3000`. The Web Admin runs separately during development.

Browser CORS access defaults to the local Web UI at
`http://127.0.0.1:5173`. Set `CORS_ORIGINS` to a comma-separated list of exact
allowed origins when the UI is served elsewhere. CORS is not authentication and
does not make a network-exposed API safe.

CI runs install, formatting, typecheck, test, and build checks on every pull
request and on pushes to `main`. Automated tests cover the local media catalog
end to end (media roots, discovery, probing through a controlled double, scans,
and catalog queries against SQLite), the shared-signal runtime primitives, and
server configuration. Scheduling, playout, and provider behavior are not built
yet, so a passing test step does not reflect full MVP coverage.

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

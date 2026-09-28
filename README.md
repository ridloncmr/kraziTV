# kraziTV

kraziTV is a deterministic, stateful television network simulator for local media libraries. Its first provider target is Plex, with Jellyfin support planned after the Plex-focused MVP.

Channels behave as if they are continuously broadcasting. When a viewer tunes in, they join the current program at its wall-clock position instead of starting it from the beginning.

## Architecture

kraziTV separates three responsibilities:

- **kraziBrain** decides what plays, when it plays, and why.
- **SignalPackager** turns selected media into a continuous stream.
- **Provider adapters** expose channels, streams, and guide data to Plex and future providers.

Provider-specific behavior must not leak into scheduling. FFmpeg command construction belongs to SignalPackager, not kraziBrain.

```text
Web Admin
    |
    v
kraziBrain ---- schedule / playout timeline / channel state
    |
    v
SignalPackager ---- MPEG-TS stream
    |
    v
Provider adapter ---- Plex first, Jellyfin later
```

The guide-facing **schedule** is separate from the **playout timeline** containing everything actually transmitted. **Channel state** identifies the current playout item and join-in-progress offset at a given time.

## Project Structure

```text
apps/
  server/      Fastify API and route wiring
  web/         React administration UI
packages/
  core/        scheduling, channel rules, and playout decisions
  media/       discovery, ffprobe, and source metadata
  signal/      FFmpeg lifecycle and stream packaging
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
```

`npm run dev` starts the API at `http://127.0.0.1:3000`. The Web Admin runs separately during development.

CI runs install, formatting, typecheck, test, and build checks on every pull
request and on pushes to `main`. At present, only `@krazitv/core` has an automated
test script, so a passing test step reflects that limited coverage rather than
full MVP behavior coverage.

## Documentation

- [`docs/specs/`](docs/specs/README.md) defines product behavior and spec statuses.
- [`docs/adrs/`](docs/adrs/README.md) records architecture decisions.
- [`docs/implementation_plan/`](docs/implementation_plan/README.md) tracks build order.
- [`docs/knowledge_base/`](docs/knowledge_base/README.md) holds research and operational references.
- [`AGENTS.md`](AGENTS.md) defines project boundaries and shared vocabulary for AI agents.
- [`.agents/README.md`](.agents/README.md) documents agent skills, roles, and harness adapters.

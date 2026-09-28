# System Bootstrap And Health

This spec defines the first vertical slice for kraziTV: starting the system locally and proving that the API and Web UI are reachable.

## Problem

kraziTV needs a small, reliable startup path before deeper product behavior is added. Developers should be able to install dependencies, start the API server, start the Web UI, and confirm that the system is alive without configuring Plex, media libraries, schedules, or streams.

Without this slice, later work on media scanning, scheduling, guide generation, and streaming has no stable feedback loop.

## Goals

- Provide a repeatable local development workflow.
- Start the Fastify API server from the workspace root.
- Expose a health endpoint for smoke tests and future deployment checks.
- Start the React/Vite Web UI from the workspace root or its workspace.
- Keep startup behavior independent from media libraries, Plex, SQLite, FFmpeg, and scheduling.
- Establish verification commands that must continue to pass as the project grows.

## Non-Goals

- Do not scan media files.
- Do not create channels.
- Do not generate schedules or playout timelines.
- Do not expose XMLTV, M3U, or stream endpoints.
- Do not connect to Plex or Jellyfin.
- Do not initialize persistent database schemas beyond any future placeholder needed for process startup.
- Do not run FFmpeg or ffprobe as part of startup.

## User-Facing Behavior

From a clean checkout with Node installed, a developer can run:

```bash
npm install
npm run dev
```

The default root `dev` command starts the API server.

The API server listens on:

```text
http://127.0.0.1:3000
```

The health endpoint is available at:

```text
GET /health
```

Successful response:

```json
{
  "status": "ok"
}
```

The Web UI can be started independently with:

```bash
npm run dev --workspace @krazitv/web
```

The initial Web UI shell should load in a browser and identify the application as kraziTV. It does not need to display live API data in this slice.

## Technical Behavior

### API Server

- The server uses Fastify.
- The server exposes `GET /health`.
- The server defaults to host `127.0.0.1`.
- The server defaults to port `3000`.
- The server accepts `HOST` and `PORT` environment variables.
- The server enables CORS for local development.
- Startup must not require database files, media roots, Plex credentials, FFmpeg, or ffprobe.

### Web UI

- The Web UI uses React, Vite, and TypeScript.
- The Web UI can be started independently from the API server.
- The Web UI shell should not hardcode Plex, Jellyfin, or media-library assumptions.

### Workspace

- The root workspace uses npm workspaces.
- Application workspaces live under `apps/*`.
- Shared package workspaces live under `packages/*`.
- Root verification commands should include `npm run typecheck`, `npm test`, `npm run build`, and `npm run format`.

## Data Model Impact

This slice should not add persistent domain data.

If future implementation introduces runtime configuration, it should be limited to process startup settings such as host, port, log level, and local data directory. Channel configuration, media metadata, schedules, and playout state belong to later specs.

## Architecture Boundaries

This slice does not materially affect:

- Schedule
- Playout timeline
- Channel state
- kraziBrain
- SignalPackager
- Provider adapters

The API server may import shared packages, but bootstrap behavior must not force core scheduling, media probing, packaging, or provider initialization to run at process startup.

Important boundaries:

- `apps/server` owns HTTP process startup and route registration.
- `apps/web` owns browser UI startup.
- `packages/core` remains free of HTTP, FFmpeg, SQLite, Plex, and Web UI concerns.
- `packages/media` should not be invoked by the health endpoint.
- `packages/plex` should not be invoked by the health endpoint.

## Open Questions

- Should the root `npm run dev` eventually start both API and Web UI, or should separate commands stay explicit?
- Should the health endpoint include version/build metadata later?
- Should there be a separate readiness endpoint once SQLite and media-provider dependencies exist?

## Acceptance Criteria

- `npm install` completes from the repository root.
- `npm run dev` starts the API server.
- `GET /health` returns HTTP 200 with `{ "status": "ok" }`.
- `npm run dev --workspace @krazitv/web` starts the Web UI.
- `npm run typecheck` passes from the repository root.
- `npm test` passes from the repository root.
- `npm run build` passes from the repository root.
- `npm run format` passes from the repository root.
- API startup does not require SQLite, Plex, media files, FFmpeg, ffprobe, schedule generation, or channel configuration.

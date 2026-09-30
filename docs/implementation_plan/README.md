# Implementation Plan

This folder tracks build sequencing, milestones, and task breakdowns.

## Detailed Plans

- [Spec 0002: Local Media Catalog](0002-media-catalog.md) - planned; SQLite
  foundation and persistent media-root API first
- [Spec 0006: Shared Channel Streaming](0006-signal-packager.md) - in
  development; runtime primitives and automated suite complete (G2), FFmpeg/Plex
  evidence gate next

## Initial Milestones

- Scaffold the TypeScript monorepo - done
- Build the server health endpoint - done
- Select Kysely for SQLite queries and migrations - done
- Add the Web UI shell - done
- Build production-intent `packages/signal` primitives for the compatibility
  spike: `ChannelStreamManager`, `ChannelWorker`, SignalPackager sessions,
  readiness-gated publication, shared fan-out, slow-subscriber isolation,
  late-join initialization, idle grace, process shutdown, pacing, and multi-item
  continuity
- Add automated lifecycle and fan-out tests using fake playout, packager, and
  process adapters, including failed administrative cleanup and idempotent
  retry - done
- Run the Plex HDHomeRun compatibility spike through those retained primitives,
  including first-worker initial tune drift, real-time pacing and any required
  startup catch-up, late join, two viewers on one encoder, idle shutdown, and a
  real two-file stream boundary; keep only the tuner metadata, channel, media
  paths, and playout inputs hard-coded in the disposable harness
- Implement the local media catalog and SQLite persistence
- Implement channel and ordered media-collection configuration
- Implement deterministic schedule generation and current channel state,
  including connection-pinned read snapshots and an interleaved two-connection
  regeneration test
- Integrate the spike-tested `packages/signal` primitives with real channel
  authorization, channel state, selected playout, and administrative shutdown
- Apply the spike's verified FFmpeg arguments and measured buffer/idle defaults
  to the retained SignalPackager and worker configuration
- Expose Plex-compatible tuner, guide, and stream endpoints
- Complete the MVP Web Admin flow

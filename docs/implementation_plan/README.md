# Implementation Plan

This folder tracks build sequencing, milestones, and task breakdowns.

## Initial Milestones

- Scaffold the TypeScript monorepo - done
- Build the server health endpoint - done
- Select Kysely for SQLite queries and migrations - done
- Add the Web UI shell - done
- Run the Plex HDHomeRun compatibility spike, including first-worker initial
  tune drift, shared channel workers, real-time pacing and any required startup
  catch-up, late join, two viewers on one encoder, idle shutdown, and a real
  two-file stream boundary
- Implement the local media catalog and SQLite persistence
- Implement channel and ordered media-collection configuration
- Implement deterministic schedule generation and current channel state
- Implement lazy `ChannelStreamManager`
- Implement one shared `ChannelWorker` per active channel
- Implement subscriber fan-out with slow-subscriber isolation
- Implement late-join support using the compatibility-spike results
- Implement SignalPackager session primitives using the compatibility-spike results
- Expose Plex-compatible tuner, guide, and stream endpoints
- Complete the MVP Web Admin flow

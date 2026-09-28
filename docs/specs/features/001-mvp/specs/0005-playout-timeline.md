# Playout Timeline

Status: Accepted

This spec defines the MVP playout timeline and channel state behavior: determining what a channel is transmitting at a wall-clock time and what offset a viewer should join at.

## Problem

kraziTV channels should behave like continuous broadcasts. When a viewer tunes in halfway through a program, playback should begin near the correct in-progress position instead of restarting the program.

The guide-facing schedule says what viewers see in the EPG. The playout timeline says what the channel is actually transmitting at each instant. For the MVP, the playout timeline can be close to the schedule because commercials and bumpers are out of scope, but it must still be modeled separately so future transmission details do not pollute guide data.

## Goals

- Build a provider-neutral playout timeline for an enabled channel.
- Determine the current playout item for a channel at a wall-clock time.
- Calculate the media offset needed to join a broadcast in progress.
- Keep channel state deterministic across API restarts.
- Use schedule entries and cataloged media as inputs.
- Produce a narrow input contract for SignalPackager.
- Keep playout decisions separate from FFmpeg command construction.

## Non-Goals

- Do not construct FFmpeg commands.
- Do not stream media.
- Do not expose Plex XMLTV, M3U, or stream endpoints.
- Do not insert commercials, bumpers, station IDs, or filler.
- Do not implement catch-up TV, pause, rewind, or per-viewer playback state.
- Do not implement multiple bitrate or transcoding profiles.
- Do not make provider-specific scheduling decisions.

## User-Facing Behavior

When a viewer tunes into a channel, kraziTV can determine the currently-running program and the playback offset.

Example:

```text
Program: Show A - Episode 2
Program started: 20:22:00
Viewer tuned in: 20:31:15
Playback offset: 00:09:15
```

The Web UI or API can expose current channel state for debugging and future admin screens.

Example current state:

```json
{
  "channelId": "channel_69",
  "currentItem": {
    "type": "program",
    "mediaItemId": "media_123",
    "title": "Show A - Episode 2",
    "startedAt": "2026-09-28T20:22:00Z",
    "endsAt": "2026-09-28T20:44:00Z",
    "offsetSeconds": 555
  }
}
```

## Technical Behavior

### Timeline Inputs

Playout timeline generation uses:

- Enabled channel configuration
- Schedule entries for the target time window
- Available media catalog items referenced by the schedule
- Wall-clock evaluation time

For the MVP, each guide-visible schedule entry maps to one program playout item unless the media item is unavailable.

### Playout Items

A playout item represents something transmitted by the channel.

MVP playout item type:

- `program`

Future playout item types:

- `commercial`
- `bumper`
- `station_id`
- `filler`

Minimum program playout item fields:

- Channel ID
- Schedule entry ID
- Media item ID
- Media path
- Title
- Starts at
- Ends at
- Duration seconds
- Start offset seconds

For the MVP, `startOffsetSeconds` is usually `0` for timeline items. The current playback offset is calculated from wall-clock time when a viewer tunes in.

### Current Item Lookup

Given a channel and wall-clock timestamp, kraziTV should find the playout item where:

```text
startsAt <= now < endsAt
```

The current offset is:

```text
now - startsAt + startOffsetSeconds
```

The offset must be clamped to the media item's playable duration.

If no item exists for the requested time, the API should return a clear no-current-item state. Later specs may introduce filler behavior.

### Channel State

Channel state is the deterministic runtime state needed to join a broadcast in progress.

Minimum current channel state fields:

- Channel ID
- Current playout item
- Current offset seconds
- Evaluated at timestamp
- Next playout item when available

Channel state can be computed on demand from persisted schedules and media catalog data for the MVP. Persisting snapshots is optional unless needed for performance or debugging.

### API

The API should expose endpoints equivalent to:

```text
GET /channels/:id/playout?start=...&end=...
GET /channels/:id/now
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

The playout endpoint returns timeline items for a bounded time window.

The now endpoint returns current channel state at the server's current wall-clock time, with an optional query parameter for testability if needed.

### Determinism

For the same channel configuration, schedule entries, media catalog state, and evaluation timestamp, current item lookup must return the same result.

The implementation should use injected clocks in core tests instead of directly reading process time inside deterministic domain logic.

## Data Model Impact

If playout timelines are persisted, minimum fields are:

```text
PlayoutItem
id
channelId
scheduleEntryId
mediaItemId
type
startsAt
endsAt
durationSeconds
startOffsetSeconds
createdAt
updatedAt
```

If playout timelines are generated on demand, these fields still describe the API/domain shape even if no table exists initially.

Current channel state does not need to be persisted for the MVP if it can be computed deterministically from schedule and media data.

## Architecture Boundaries

This slice affects:

- Schedule: indirectly, by consuming schedule entries.
- Playout timeline: directly.
- Channel state: directly.
- kraziBrain: directly, it owns timeline and current-state decisions.
- SignalPackager: indirectly, by producing the input it will consume.
- Provider adapters: indirectly, by enabling future stream endpoints to resolve current content.

Important boundaries:

- kraziBrain decides which playout item is current and what offset should be used.
- SignalPackager receives selected media and offset later; it does not decide what should be playing.
- Playout timeline generation must not construct FFmpeg commands.
- Playout timeline generation must not emit Plex-specific output.
- Schedule entries remain guide-facing; playout items represent transmission-facing items.
- `packages/core` should own current item lookup and offset calculation.
- `apps/server` should own API routing, persistence wiring, and request validation.

## Open Questions

- Should playout items be persisted immediately or generated on demand from schedule entries for MVP?
- Should `/now` accept an explicit timestamp query for debugging and deterministic integration tests?
- What should happen if the current schedule entry references media that has become missing?
- Should clock skew or server timezone handling be defined here or in an operational config spec?
- Should generated playout windows extend beyond schedule windows to guarantee a next item?

## Acceptance Criteria

- A playout timeline can be produced for an enabled channel with generated schedule entries.
- A current playout item can be resolved for a channel and wall-clock timestamp.
- The current offset is calculated from wall-clock time and item start time.
- Current offset is clamped to the media item's playable duration.
- The same inputs and timestamp produce the same current item and offset.
- Channel state can report current item, current offset, evaluated timestamp, and next item when available.
- Playout timeline behavior does not require Plex, Jellyfin, FFmpeg command construction, stream packaging, XMLTV, or M3U output.
- Playout items are distinct from guide schedule entries even when they map one-to-one in the MVP.

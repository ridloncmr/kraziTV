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
- Produce a narrow current/future playout contract for active channel stream workers.
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

When a viewer tunes into a channel, kraziTV can determine the currently-running program and the playback offset. Provider stream routes use this state to subscribe the viewer to the channel's shared active broadcast worker, starting that worker lazily when needed.

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
    "offsetMs": 555000
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

For the MVP, each guide-visible schedule entry maps to one derived program playout item when its media item is available. Playout items are generated on demand from persisted schedule entries; they are not stored in a separate table.

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
- Duration milliseconds
- Start offset milliseconds

For the MVP, `startOffsetMs` is usually `0` for timeline items. The current playback offset is calculated from wall-clock time when a viewer tunes in.

### Current Item Lookup

Given a channel and wall-clock timestamp, kraziTV should find the playout item where:

```text
startsAt <= now < endsAt
```

The current offset is:

```text
now - startsAt + startOffsetMs
```

The offset must be clamped to the media item's playable duration.

If no schedule entry exists for the requested time, the API returns a no-current-item state with reason `schedule_gap`.

If the current schedule entry references missing or otherwise unavailable media, kraziTV must not silently substitute another program because that would disagree with the published schedule. The API returns a no-current-item state with reason `media_unavailable` and identifies the affected schedule entry. The stream endpoint fails before sending media bytes. Later filler behavior may provide an explicit replacement policy.

### Channel State

Channel state is the deterministic runtime state needed to join a broadcast in progress.

Minimum current channel state fields:

- Channel ID
- Current playout item
- Current offset milliseconds
- Evaluated at timestamp
- Next playout item when available

Channel state is computed on demand from persisted schedules and media catalog data for the MVP. Channel-state snapshots are not persisted.

Channel state also supplies selected current and following playout items to the runtime stream layer. A `ChannelWorker` may ask for more future playout when its queue is low, but the worker does not select media or decide what should play next.

### API

The API should expose endpoints equivalent to:

```text
GET /channels/:id/playout?start=...&end=...
GET /channels/:id/now
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

The playout endpoint returns timeline items for a bounded time window.

The now endpoint returns current channel state at the server's current wall-clock time. It also accepts an optional ISO 8601 `at` timestamp for deterministic tests and debugging; production provider flows omit it.

### Determinism

For the same channel configuration, schedule entries, media catalog state, and evaluation timestamp, current item lookup must return the same result.

The implementation should use injected clocks in core tests instead of directly reading process time inside deterministic domain logic.

All internal and persisted instants use integer UTC Unix epoch milliseconds.
Provider-neutral API responses serialize instants as UTC ISO 8601 values, while
duration and offset fields remain integer milliseconds. User-interface timezone
conversion is presentation behavior and must not change schedule or playout
calculations.

## Data Model Impact

The derived playout item domain shape is:

```text
PlayoutItem
id
channelId
scheduleEntryId
mediaItemId
mediaPath
title
type
startsAt
endsAt
durationMs
startOffsetMs
createdAt
updatedAt
```

`mediaPath` is an internal packaging input and must not be exposed by public API responses. Public playout and channel-state responses may omit internal-only fields while preserving the remaining domain semantics.

`createdAt` and `updatedAt` reflect the source schedule entry; no separate playout-item persistence is added. Current channel state is also not persisted because it is computed deterministically from schedule and media data.

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
- Channel stream workers receive selected current and following playout items; they do not decide what should be playing.
- SignalPackager receives selected media, media offset, and play duration from the worker later; it does not decide what should be playing.
- Playout timeline generation must not construct FFmpeg commands.
- Playout timeline generation must not emit Plex-specific output.
- Schedule entries remain guide-facing; playout items represent transmission-facing items.
- `packages/core` should own current item lookup and offset calculation.
- `apps/server` should own API routing, persistence wiring, and request validation.

## Acceptance Criteria

- A playout timeline can be produced for an enabled channel with generated schedule entries.
- A current playout item can be resolved for a channel and wall-clock timestamp.
- The current offset is calculated from wall-clock time and item start time.
- Playout arithmetic uses integer milliseconds without repeated floating-point
  conversion.
- Current offset is clamped to the media item's playable duration.
- The same inputs and timestamp produce the same current item and offset.
- Channel state can report current item, current offset, evaluated timestamp, and next item when available.
- Channel state can supply selected current and following playout items to a shared channel worker.
- Unavailable media produces an explicit `media_unavailable` state without silently changing the schedule.
- Playout items and channel state are derived on demand and are not persisted separately in the MVP.
- Schedule, playout, and channel-state timestamps are interpreted in UTC.
- Playout timeline behavior does not require Plex, Jellyfin, FFmpeg command construction, stream packaging, XMLTV, or M3U output.
- Playout items are distinct from guide schedule entries even when they map one-to-one in the MVP.

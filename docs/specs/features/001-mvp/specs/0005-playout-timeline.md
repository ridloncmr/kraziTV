# Playout Timeline

Status: Implemented

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

Example current state from `GET /channels/:id/now`:

```json
{
  "channelId": "channel_69",
  "scheduleRevision": 12,
  "evaluatedAt": "2026-09-28T20:31:15.000Z",
  "currentItem": {
    "type": "program",
    "scheduleEntryId": "entry_456",
    "mediaItemId": "media_123",
    "title": "Show A - Episode 2",
    "startsAt": "2026-09-28T20:22:00.000Z",
    "endsAt": "2026-09-28T20:44:00.000Z",
    "durationMs": 1320000,
    "startOffsetMs": 0,
    "offsetMs": 555000,
    "createdAt": "2026-09-28T12:00:00.000Z",
    "updatedAt": "2026-09-28T12:00:00.000Z"
  },
  "nextItem": null
}
```

`nextItem` has the same fields as `currentItem` except `offsetMs`. When nothing
can be transmitted, the response is the no-current variant:

```json
{
  "channelId": "channel_69",
  "scheduleRevision": 12,
  "evaluatedAt": "2026-09-28T20:31:15.000Z",
  "currentItem": null,
  "nextItem": null,
  "reason": "media_unavailable",
  "scheduleEntryId": "entry_456"
}
```

`scheduleEntryId` appears only with reason `media_unavailable`.

## Technical Behavior

### Timeline Inputs

Playout timeline generation uses:

- Enabled channel configuration
- Schedule entries for the target time window
- Available media catalog items referenced by the schedule
- Wall-clock evaluation time

For the MVP, each guide-visible schedule entry maps to one derived program playout item when its media item is available. Playout items are generated on demand from persisted schedule entries; they are not stored in a separate table.

Because that MVP mapping is one-to-one, `scheduleEntryId` is the stable identity
and continuation cursor for a derived program playout item. The MVP does not
create a separate `playoutItemId`. Following-item lookup finds the source
schedule entry within the channel and continues in channel sequence order.
Schedule revision revalidation prevents a worker from continuing with a cursor
into future entries that regeneration has replaced.

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
- Schedule entry ID, also used as the stable MVP playout cursor
- Media item ID
- Media path (internal only)
- Has audio (internal only)
- Title
- Starts at
- Ends at
- Duration milliseconds
- Start offset milliseconds

For the MVP, `startOffsetMs` is `0` for every item. The current playback offset
is calculated from wall-clock time when a viewer tunes in.

An item has two lengths:

- `durationMs` is the media's playable length, read from the catalog in the
  same snapshot as the entry.
- Airtime is `endsAt - startsAt`, fixed when the entry was generated.

They differ when a rescan changes a file after its entry was published.

Media is **playable** when its status is `available`, its `durationMs` is a
positive integer, and its `hasAudio` fact is known. Playable differs from
schedulable: it has no duration floor, and it requires the audio fact
packaging needs. Only entries with playable media become playout items.

### Current Item Lookup

Given a channel and wall-clock timestamp, kraziTV should find the playout item where:

```text
startsAt <= now < endsAt
```

The current offset is:

```text
now - startsAt + startOffsetMs
```

All arithmetic is integer milliseconds and the offset is never clamped. Media
longer than its airtime plays from the computed offset. An offset at or past
`durationMs` leaves nothing to play, which happens when media was re-probed
shorter than its airtime; that entry is reported as `media_unavailable`, so the
API and the stream route always agree.

If no schedule entry exists for the requested time, the API returns a no-current-item state with reason `schedule_gap`.

If the current schedule entry's media is not playable, or its offset is at or
past `durationMs`, kraziTV must not silently substitute another program because
that would disagree with the published schedule. The API returns a
no-current-item state with reason `media_unavailable` and identifies the
affected schedule entry. The stream endpoint fails before sending media bytes.
Later filler behavior may provide an explicit replacement policy.

The next item is the entry after the current one in channel sequence order,
but only when it starts exactly at the current item's `endsAt` and its media is
playable. Otherwise, and always when there is no current item, the next item
is `null`. Near the edge of generated coverage the next entry may not exist
yet, which also gives `null`.

### Following Items

A channel stream worker asks for the items that follow a cursor
`scheduleEntryId`. The selection:

- Returns `stale_entry` with no items when the cursor entry no longer exists on
  the channel, because regeneration deleted it.
- Otherwise walks entries after the cursor in channel sequence order and
  returns the prefix that is contiguous by time, each item starting exactly at
  the previous item's `endsAt` (beginning from the cursor's `endsAt`), and
  playable, up to the requested count.
- Stops at the first time gap or unplayable entry. An empty selection is valid.

Contiguity is judged by time, never by consecutive sequence numbers, because
sequence numbers are not reused after regeneration.

A following item whose media is shorter than its airtime is still selected; its
transmission is limited to the media length. What the broadcast signal carries
for the rest of that airtime is a SignalPackager concern outside this spec.

When the entry after the current item is unplayable or separated by a gap, the
selection is empty and the worker cannot transition, so the broadcast ends at
that boundary. Tunes then receive `media_unavailable` or `schedule_gap` until
playable coverage resumes. The MVP accepts this; filler is the future
replacement policy.

### Channel State

Channel state is the deterministic runtime state needed to join a broadcast in progress.

Minimum current channel state fields:

- Channel ID
- Schedule revision
- Current playout item
- Current offset milliseconds
- Evaluated at timestamp
- Next playout item when available

Channel state is computed on demand from persisted schedules and media catalog data for the MVP. Channel-state snapshots are not persisted.

A channel with no schedule state yet reports `scheduleRevision` `0`. Revisions
start at `1`, so `0` never collides with a real revision. Playout responses use
`0` where `GET /channels/:id/schedule` reports `null`, because the runtime
playout contract requires a number.

### Consistent Schedule Read Snapshots

The persistence adapter that supplies current channel state and following
playout must read every SQLite row contributing to one result from one
connection-pinned read transaction. This includes `ChannelScheduleState`, source
schedule entries, channel configuration needed for authorization, and media
catalog rows used for availability, path, and duration. The adapter reads
`scheduleRevision` first, establishing the SQLite read snapshot, and performs
every later query through the same Kysely transaction object. It returns the
revision and the plain typed source data together to kraziBrain-owned domain
logic.

Ordinary Kysely `db.transaction()` is appropriate for this read-only invariant:
it pins one connection and SQLite's first read establishes the snapshot used by
the rest of that transaction. This is distinct from schedule mutation and
following-item transition commitment, which require the project-owned
`BEGIN IMMEDIATE` helper to acquire write authority before reading. Snapshot
code must never mix the transaction object with the root `db` handle.

The read transaction must remain read-only. If it discovers missing horizon
coverage or a schedule gap requiring repair, it returns a typed retry condition
to the application layer and ends. The application performs the required
schedule mutation separately through the immediate-transaction helper, then
retries the complete snapshot read. It must not attempt to upgrade the existing
deferred read transaction into a write transaction.

A single SQL statement that returns the complete revision and source projection
would also be snapshot-safe, but the MVP standardizes the multi-query repository
implementation on the connection-pinned read transaction. Kysely transaction
objects and database row shapes do not cross into `packages/krazi-brain` or
`packages/signal`.

Channel state also supplies selected current and following playout items to the
runtime stream layer. Each selection carries the `scheduleRevision` read from
`ChannelScheduleState` in the same consistent database snapshot as the schedule
entries used to derive it. A `ChannelWorker` may prefetch future playout, but
prefetched and SignalPackager-prepared items are only revocable candidates. At
or after the scheduled boundary, the worker delegates to an injected
`TransitionCoordinator`. Its production persistence adapter acquires the same
SQLite immediate-transaction coordination boundary as schedule mutation,
revalidates the candidate revision and entry, and synchronously invokes the
valid preparation's commit before releasing that boundary. The worker never
imports SQLite or Kysely. A mismatch discards every stale preparation and
requests fresh selected playout from kraziBrain-owned domain logic. The
successful preparation commit is the point at which the item becomes the
current broadcast item. The currently transmitting item continues; the worker
does not replace it merely because its selection revision became old.

The worker does not select media or decide what should play next. A prefetched
queue must never become an authoritative programming source independent of the
materialized schedule.

### API

The API should expose endpoints equivalent to:

```text
GET /channels/:id/playout?start=...&end=...
GET /channels/:id/now
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

The playout endpoint returns timeline items for a bounded time window. It
shares the schedule route's window validation: `start` before `end`, at most 7
days apart. It returns `{ channelId, scheduleRevision, items }`, with playable
entries overlapping `[start, end)` as playout items ordered by `startsAt`.
Unplayable entries are omitted; the now endpoint is where `media_unavailable`
is reported. The playout endpoint ensures coverage through `end`, as a future
`at` does for the now endpoint, so a window past the horizon is never silently
partial; an `end` past the request limit is rejected.

The now endpoint returns current channel state at the server's current
wall-clock time, in the shape shown under User-Facing Behavior. It also
accepts an optional ISO 8601 `at` timestamp for deterministic tests and
debugging; production provider flows omit it. The evaluation time is fixed once
per request. A future `at` ensures schedule coverage through it, so a debugging
read may extend the horizon. Generation is deterministic, so this changes when
entries are written, never what airs.

Public responses omit `mediaPath` and `hasAudio`. Instants are UTC ISO 8601
strings; durations and offsets are integer milliseconds.

Both endpoints ensure schedule coverage before answering. When a read finds
coverage missing, the server ensures coverage once and retries the read once.
If coverage is still short, because another writer won the race, the request
fails with a retryable `503 schedule_busy`.

| Channel condition                | `/now`                                   | `/playout`                                    |
| -------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Disabled                         | `409 channel_disabled`                   | `409 channel_disabled`                        |
| No block or no schedulable media | Existing entries; none is `schedule_gap` | Existing entries; none is `200` with no items |

A disabled channel transmits nothing, so it has no channel state; its guide
remains available from `GET /channels/:id/schedule`. An unschedulable channel's
empty transmission is a state, not an error, unlike `/schedule`'s
`409 channel_unschedulable`.

Errors use the existing API error envelope and codes:

| Code                | Status | When                                                                            |
| ------------------- | ------ | ------------------------------------------------------------------------------- |
| `channel_not_found` | 404    | Unknown channel                                                                 |
| `channel_disabled`  | 409    | Disabled channel                                                                |
| `invalid_request`   | 400    | Bad `at`, `start`, or `end`; a window over 7 days; `at` or `end` past the limit |
| `schedule_busy`     | 503    | Write authority busy, or coverage still short after the retry                   |

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
channelId
scheduleRevision
scheduleEntryId
mediaItemId
mediaPath
hasAudio
title
type
startsAt
endsAt
durationMs
startOffsetMs
createdAt
updatedAt
```

`mediaPath` and `hasAudio` are internal packaging inputs and must not be
exposed by public API responses. Public playout and channel-state responses may omit internal-only fields while preserving the remaining domain semantics.

`scheduleRevision` identifies the materialized schedule snapshot from which the
item was selected. `scheduleEntryId` is the item's MVP identity and stable
following-item cursor. `createdAt` and `updatedAt` reflect the source schedule
entry; no separate playout-item persistence or identifier is added. Current
channel state is also not persisted because it is computed deterministically
from schedule and media data.

When commercials, bumpers, or other behavior allow one schedule entry to
produce multiple playout items, the playout contract will introduce a richer
`PlayoutCursor` that identifies a position within the expanded transmission
sequence. That future need does not justify an undefined derived ID in the MVP.

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
- `packages/krazi-brain` should own current item lookup and offset calculation.
- `apps/server` should own API routing, persistence wiring, request validation,
  and the connection-pinned schedule snapshot repository.

## Acceptance Criteria

- A playout timeline can be produced for an enabled channel with generated schedule entries.
- A current playout item can be resolved for a channel and wall-clock timestamp.
- The current offset is calculated from wall-clock time and item start time.
- Playout arithmetic uses integer milliseconds without repeated floating-point
  conversion.
- A current offset at or past the media's playable duration produces
  `media_unavailable` instead of a current item.
- Following selections are the contiguous, playable prefix after a cursor, and
  a missing cursor produces `stale_entry`.
- The same inputs and timestamp produce the same current item and offset.
- Channel state can report current item, current offset, evaluated timestamp, and next item when available.
- Channel state can supply selected current and following playout items to a shared channel worker.
- Current and following selections carry the materialized `scheduleRevision`
  read consistently with their source entries.
- The persistence adapter reads the revision and every SQLite source row for one
  current/following result through one Kysely read transaction and never falls
  back to the root database handle inside that transaction.
- A multi-connection integration test pauses after the revision read, commits a
  regeneration from another connection, and proves that the reader returns a
  complete old or complete new snapshot, never a mixed revision and entry set.
- Missing coverage ends the read transaction before horizon maintenance or gap
  repair runs; the complete snapshot read is retried afterward.
- A future selection or packaging preparation remains revocable until the
  worker validates and commits it at its scheduled boundary.
- Unavailable media produces an explicit `media_unavailable` state without silently changing the schedule.
- Playout items and channel state are derived on demand and are not persisted separately in the MVP.
- Schedule, playout, and channel-state timestamps are interpreted in UTC.
- Playout timeline behavior does not require Plex, Jellyfin, FFmpeg command construction, stream packaging, XMLTV, or M3U output.
- Playout items are distinct from guide schedule entries even when they map one-to-one in the MVP.
- `scheduleEntryId` is the stable MVP playout identity and following-item cursor;
  no separate `playoutItemId` is required.

# Schedule Generation

Status: Accepted

This spec defines MVP guide schedule generation: producing deterministic, provider-neutral schedule entries for configured channels from cataloged local media.

## Problem

kraziTV needs a guide-facing schedule before Plex or any future provider can show users what is on a channel. The schedule should represent what viewers see in a TV guide, not every media segment transmitted during playback.

The schedule must be deterministic so repeated generation for the same channel, media catalog, configuration, and time window produces the same entries. Without deterministic schedules, guide data, channel state, and playout behavior will drift from each other.

## Goals

- Generate schedule entries for enabled channels.
- Use channel configuration and cataloged media as inputs.
- Support chronological and random playback modes.
- Produce deterministic output for a requested time window.
- Keep schedule entries provider-neutral.
- Keep schedule generation separate from playout timeline generation.
- Persist generated schedule entries.
- Maintain a future schedule horizon for enabled channels.
- Provide enough schedule data for later XMLTV guide generation.

## Non-Goals

- Do not generate playout timelines.
- Do not calculate current playback offsets.
- Do not stream media.
- Do not run FFmpeg or ffprobe.
- Do not expose Plex XMLTV, M3U, or stream endpoints.
- Do not insert commercials, bumpers, station IDs, or filler.
- Do not implement daypart schedules, seasonal rules, theme blocks, or manual overrides.
- Do not require perfect TV season/episode metadata.

## User-Facing Behavior

A user with a configured channel and cataloged media can request upcoming programming for that channel.

Example guide-facing schedule:

```text
Channel 69 - Krazi Comedy

20:00 - 20:22  Show A - Episode 1
20:22 - 20:44  Show A - Episode 2
20:44 - 21:06  Show A - Episode 3
21:06 - 21:28  Show B - Episode 1
```

The user should see stable schedule output when requesting the same channel and time window multiple times, assuming channel configuration and media catalog inputs have not changed.

If a channel has no schedulable media, the API should report that the channel cannot generate a schedule instead of producing fake entries.

Overlapping schedule requests must agree on overlapping time ranges. For example, if a request for 12:00-18:00 returns `15:00 Psych`, a later request for 15:00-21:00 must return the same 15:00 entry unless an explicit regeneration policy has replaced that future period.

## Technical Behavior

### Inputs

Schedule generation uses:

- Enabled channel configuration
- Channel playback mode
- Channel media collection selection
- Available media catalog items
- Requested schedule window start
- Requested schedule window end
- Persisted channel schedule state

Only media items with status `available` and valid positive durations are schedulable.

### Schedule Entries

A schedule entry represents one guide-visible program.

Minimum schedule entry fields:

- Channel ID
- Media item ID
- Title
- Start time
- End time
- Duration milliseconds
- Monotonically increasing sequence number within the channel timeline

Schedule entries must not represent commercials, bumpers, station IDs, FFmpeg segments, transcode decisions, or stream URLs.

### Chronological Playback

Chronological playback uses the media collection's explicit membership order. It must not substitute title or path sorting for that order.

When the end of the selected media set is reached, chronological playback may loop back to the first item for the MVP.

### Random Playback

Random playback must be deterministic for the same inputs. Each channel stores a random seed in `ChannelScheduleState`. The initial seed is derived from the stable channel ID and schedule anchor. Selection is derived from that seed plus each entry's channel-wide sequence number, so regeneration can reproduce an entry without replaying mutable process state. It must not rely on process-global randomness or a request-window-specific seed.

The MVP may allow repeats. Repeat prevention can be added later once playback history exists.

### Schedule Windows

The API should support retrieving persisted schedule entries for a bounded time window.

The first implementation should support at least a 24-hour window. Longer windows can be supported if generation remains predictable and reasonably fast.

Entries may begin before the requested window if the program overlaps the window start. Entries may end after the requested window if the program overlaps the window end.

kraziBrain maintains a schedule through at least 72 hours beyond the current time for enabled, schedulable channels. The server ensures this horizon at startup, when a channel becomes enabled or its scheduling inputs change, after a catalog scan makes a channel schedulable, and before guide, channel-state, or stream requests that require coverage. A periodic background check may extend the horizon proactively, but correctness must not depend on that timer. API reads may request smaller bounded windows.

### API

The API should expose endpoints equivalent to:

```text
GET /channels/:id/schedule?start=...&end=...
POST /channels/:id/schedule/generate
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

The retrieval endpoint should return schedule entries for the requested channel and time window.

The generation endpoint can be synchronous for the MVP if the requested window is bounded. It is an explicit administrative trigger that ensures persisted coverage through the requested end; it does not replace entries in an already-covered window unless the request invokes the regeneration policy below.

### Persistence

The MVP persists generated schedule entries.

Persisted entries are the authority for guide data and the shared scheduling input from which kraziBrain derives the playout timeline and channel state. Stream selection consumes that derived channel state. Schedule reads and horizon maintenance must not replace entries in already-covered windows.

Schedule generation should extend the persisted schedule forward from the last generated entry for a channel. Repeated generation requests should be idempotent for already-covered windows unless an explicit regeneration operation is requested.

Every schedule mutation for a channel must be atomic. Initial state creation,
horizon extension, gap repair, and delete-and-regenerate operations each run in
one SQLite write transaction. The mutation must acquire database write authority
before reading the current entries and `ChannelScheduleState`, obtain its
effective current time after acquiring that authority, then re-evaluate the
required work inside that transaction. Entry inserts or deletes and updates
to `lastGeneratedThrough`, `nextSequenceNumber`, `scheduleRevision`, and other
schedule state commit together or roll back together.

`ChannelScheduleState.scheduleRevision` is a monotonically increasing safe
integer that identifies the committed materialized schedule revision for a
channel. State creation with the initial materialized entries sets it to `1`.
Every successful transaction that changes the channel's persisted schedule
entry set, ordering, or contents increments it exactly once. A transaction that
only checks coverage and makes no entry change does not increment it. The
revision update commits atomically with the affected entries so readers cannot
observe new programming with an old revision or old programming with a new
revision.

Concurrent requests for the same channel must serialize at the database
boundary. An in-process mutex may reduce contention, but it is not the
correctness mechanism because another process or connection could bypass it.
The SQLite implementation uses a project-owned immediate-transaction helper
that pins one Kysely connection and executes `BEGIN IMMEDIATE` before reading
schedule entries or `ChannelScheduleState`. Every read and write in the mutation
uses the Kysely instance bound to that connection, followed by an explicit
`COMMIT` or `ROLLBACK` on the same connection. Ordinary Kysely
`db.transaction()` starts a deferred SQLite transaction and does not satisfy
this requirement.

An active worker's following-item transition uses the same immediate-transaction
helper as a coordination boundary. At or after the scheduled boundary, the
worker acquires write authority, obtains the boundary time, revalidates the
candidate entry and `scheduleRevision`, and synchronously commits its prepared
SignalPackager item before releasing authority. The transition does not mutate
the materialized schedule or increment `scheduleRevision`. If regeneration owns
write authority first, the worker validates only after its commit and observes
the resulting revision. If transition commit occurs first, regeneration obtains
its effective time afterward and preserves that now-current entry through
`endsAt`.

The helper must not be nested or mixed with Kysely-managed transactions or
`better-sqlite3` transaction wrappers. A request that cannot acquire write
authority must retry the entire mutation from freshly read persisted state or
return a retryable error; it must not commit entries calculated from stale
state.

When a channel first becomes enabled with schedulable media, the server creates `ChannelScheduleState`. Its `anchorTime` is the current UTC Unix epoch millisecond and remains stable across restarts. Generation starts at that anchor and advances continuously from persisted state.

If channel configuration or media collection order changes while an entry is airing, that entry remains authoritative through its existing `endsAt`. Entries starting at or after that boundary are deleted and regenerated from the new inputs. If no entry is airing, the regeneration boundary is the current UTC Unix epoch millisecond; future entries at or after that boundary are deleted and regenerated. Initial generation starts at the anchor persisted when `ChannelScheduleState` is created.

Gap repair is separate from ordinary horizon extension. If an enabled, schedulable channel has no entry covering the current time, the server must explicitly repair and log the gap before extending the future horizon. Repair starts at the end of the latest entry before the gap, or at the current UTC Unix epoch millisecond when no prior entry exists, and regenerates subsequent entries so schedule coverage is contiguous. Routine schedule reads must not silently use gap repair to rewrite a covered window.

Catalog availability changes do not rewrite already-materialized entries. Missing-media behavior is handled by channel-state lookup so the guide does not silently change after publication.

## Data Model Impact

Minimum schedule entry fields if entries are persisted:

```text
ScheduleEntry
id
channelId
mediaItemId
title
startsAt
endsAt
durationMs
sequenceNumber
createdAt
updatedAt
```

Required schedule state fields:

```text
ChannelScheduleState
channelId
seed
anchorTime
lastGeneratedThrough
regenerationAllowedAfter
nextSequenceNumber
algorithmVersion
scheduleRevision
createdAt
updatedAt
```

Schedule data should reference media catalog items but should not duplicate raw ffprobe output.

Durations use integer milliseconds. Persisted schedule instants, including
`startsAt`, `endsAt`, and all `ChannelScheduleState` time fields, use integer UTC
Unix epoch milliseconds. API boundaries may serialize those instants as UTC ISO
8601 strings, but schedule arithmetic and database queries use the integer values.

The schema must enforce one `ChannelScheduleState` row per channel and a unique
`(channelId, sequenceNumber)` pair for schedule entries. It must also index
`(channelId, startsAt)` and `(channelId, endsAt)` so bounded-window, current-entry,
and horizon-boundary queries do not require scanning schedule entries for every
channel. SQLite cannot express non-overlapping time ranges with a standard unique
constraint, so overlap prevention remains part of the transactional mutation
invariant and must be covered by tests.

## Architecture Boundaries

This slice affects:

- Schedule: directly, this is the first guide-facing schedule behavior.
- Playout timeline: not directly; timelines consume or align with schedule later.
- Channel state: not directly; current runtime state is defined later.
- kraziBrain: directly, it owns schedule selection and deterministic ordering.
- SignalPackager: not directly.
- Provider adapters: indirectly, by producing provider-neutral guide data they can map later.

Important boundaries:

- Schedule generation must not construct FFmpeg commands.
- Schedule generation must not emit Plex-specific XMLTV or M3U fields.
- Schedule entries must remain guide-visible programming, not complete transmission timelines.
- `packages/core` should own deterministic schedule algorithms and types.
- `apps/server` should own API routing, persistence wiring, and request validation.
- `packages/media` provides catalog data but does not decide programming order.
- Provider adapters map schedule entries later; they do not decide what plays.

## Acceptance Criteria

- Schedule entries can be generated for an enabled channel with schedulable media.
- Generated schedule entries are persisted.
- Each schedule mutation commits its entry changes and channel schedule state in
  one database transaction.
- Concurrent generation requests cannot allocate the same channel sequence
  number or create overlapping schedule entries.
- Integration tests using at least two connections to the same SQLite database
  prove that a schedule mutation acquires write authority before reading and
  that a losing concurrent request retries from fresh state or fails with a
  retryable error.
- Multi-connection integration tests prove both orderings of a concurrent
  schedule regeneration and following-item transition: regeneration first
  invalidates the prepared item, while transition commit first preserves the
  newly current entry.
- The database enforces unique `(channelId, sequenceNumber)` values and provides
  channel/time indexes for schedule range lookups.
- Overlapping schedule reads return the same persisted entries for the overlapping time range.
- Schedule generation extends a channel's future schedule horizon without changing already-materialized entries.
- Generated entries include channel ID, media item ID, title, start time, end time, and duration.
- Schedule durations and persisted instants use integer milliseconds.
- The same inputs produce the same schedule entries for the same requested window.
- Chronological mode follows explicit media-collection order.
- Random mode derives each selection from the persisted seed and channel-wide sequence number.
- Configuration changes do not silently change the currently airing program.
- Configuration changes regenerate entries beginning at the current program end or the next future entry when nothing is airing.
- Every committed change to a channel's materialized schedule increments its
  `scheduleRevision` atomically with the entry changes; no-op coverage checks do
  not increment it.
- Enabled schedulable channels maintain at least 72 hours of future schedule data.
- Channels with no schedulable media return a clear scheduling error or empty-state response.
- Schedule generation does not require Plex, Jellyfin, FFmpeg, stream packaging, playout timeline generation, or channel runtime state.
- Schedule entries represent guide-visible programs, not commercials, bumpers, stream segments, or provider-specific output.

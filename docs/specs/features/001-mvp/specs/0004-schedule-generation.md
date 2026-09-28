# Schedule Generation

Status: Draft

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
- Persist generated schedule entries or persist enough schedule state to reproduce them reliably.
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

## Technical Behavior

### Inputs

Schedule generation uses:

- Enabled channel configuration
- Channel playback mode
- Channel source selection
- Available media catalog items
- Requested schedule window start
- Requested schedule window end
- Deterministic seed or channel schedule state

Only media items with status `available` and valid positive durations are schedulable.

### Schedule Entries

A schedule entry represents one guide-visible program.

Minimum schedule entry fields:

- Channel ID
- Media item ID
- Title
- Start time
- End time
- Duration seconds
- Sequence number within the generated window or channel timeline

Schedule entries must not represent commercials, bumpers, station IDs, FFmpeg segments, transcode decisions, or stream URLs.

### Chronological Playback

Chronological playback uses a stable order for the selected media set.

The initial ordering should be deterministic from available catalog data. Acceptable first-pass ordering can use normalized title and path ordering. Later specs may refine this with show, season, and episode metadata.

When the end of the selected media set is reached, chronological playback may loop back to the first item for the MVP.

### Random Playback

Random playback must be deterministic for the same inputs.

The implementation should use a seed derived from stable channel identity and schedule period, or persisted channel schedule state. It must not rely on process-global randomness.

The MVP may allow repeats. Repeat prevention can be added later once playback history exists.

### Schedule Windows

The API should support generating or retrieving schedule entries for a bounded time window.

The first implementation should support at least a 24-hour window. Longer windows can be supported if generation remains predictable and reasonably fast.

Entries may begin before the requested window if the program overlaps the window start. Entries may end after the requested window if the program overlaps the window end.

### API

The API should expose endpoints equivalent to:

```text
GET /channels/:id/schedule?start=...&end=...
POST /channels/:id/schedule/generate
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

The retrieval endpoint should return schedule entries for the requested channel and time window.

The generation endpoint can be synchronous for the MVP if the requested window is bounded.

### Persistence

The MVP can choose either:

- Persist generated schedule entries.
- Persist deterministic schedule state and regenerate entries on demand.

The chosen approach must keep guide responses stable across API restarts.

If persisted schedule entries become stale because channel configuration or media catalog inputs changed, the system should either regenerate the affected window or clearly mark the schedule as stale.

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
durationSeconds
sequenceNumber
createdAt
updatedAt
```

Optional schedule state fields if deterministic state is persisted:

```text
ChannelScheduleState
channelId
seed
anchorTime
lastGeneratedThrough
createdAt
updatedAt
```

Schedule data should reference media catalog items but should not duplicate raw ffprobe output.

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

## Open Questions

- Should schedules be persisted as generated entries or generated on demand from persisted state?
- What should the default schedule anchor time be for a newly created channel?
- Should chronological playback sort by path, title, or inferred episode metadata in the first implementation?
- Should random playback use a daily seed, channel seed, or persisted sequence state?
- How far ahead should kraziTV generate guide data for Plex in the MVP?

## Acceptance Criteria

- Schedule entries can be generated for an enabled channel with schedulable media.
- Generated entries include channel ID, media item ID, title, start time, end time, and duration.
- The same inputs produce the same schedule entries for the same requested window.
- Chronological mode uses a stable media ordering.
- Random mode uses deterministic seeded selection.
- Channels with no schedulable media return a clear scheduling error or empty-state response.
- Schedule generation does not require Plex, Jellyfin, FFmpeg, stream packaging, playout timeline generation, or channel runtime state.
- Schedule entries represent guide-visible programs, not commercials, bumpers, stream segments, or provider-specific output.

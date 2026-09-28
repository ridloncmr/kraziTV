# Channel Configuration

Status: Draft

This spec defines the MVP channel configuration slice: creating channels, assigning stable channel identity, selecting cataloged media as channel input, and storing enough configuration for later schedule generation.

## Problem

kraziTV needs user-defined channels before it can generate schedules, playout timelines, guide data, or provider-facing channel lists. A channel is the viewer-facing broadcast identity, but its configuration must stay provider-neutral so Plex, Jellyfin, and future adapters can expose the same channel without changing core scheduling rules.

The MVP needs channel configuration that is useful enough to drive basic scheduling while avoiding premature support for advanced programming blocks, commercials, seasonal rules, or provider-specific options.

## Goals

- Let users create, list, update, enable, disable, and delete channels.
- Assign each channel a stable internal identifier.
- Require a channel number and display name.
- Allow a channel to select cataloged local media as its source.
- Support chronological and random playback modes.
- Persist channel configuration in SQLite.
- Keep channel configuration provider-neutral.
- Provide enough channel data for later schedule generation, playout timeline generation, and Plex exposure.

## Non-Goals

- Do not generate schedules.
- Do not generate playout timelines.
- Do not stream media.
- Do not expose Plex XMLTV, M3U, or stream endpoints.
- Do not implement commercials, bumpers, station IDs, or filler rules.
- Do not implement time-block programming or daypart schedules.
- Do not implement provider-specific channel identifiers beyond future adapter mappings.
- Do not require artwork or channel logos for the MVP.

## User-Facing Behavior

A user can create a channel with:

- Channel number
- Channel name
- Enabled state
- Playback mode
- Media source selection

Example channel:

```text
Channel 69
Name: Krazi Comedy
Playback mode: Chronological
Source: /mnt/media/TV/Comedy
Enabled: true
```

The user can list configured channels and see whether each channel is enabled, what source it uses, and what playback mode it will use when schedules are generated.

Disabling a channel keeps its configuration but excludes it from future guide, provider, and playout behavior.

Deleting a channel removes the channel configuration. Future implementation may preserve historical playback data, but the MVP does not require that history.

## Technical Behavior

### Channel Identity

- Each channel has a stable internal `id`.
- Each channel has a user-visible `number`.
- Each channel has a user-visible `name`.
- Channel numbers must be unique among active configured channels.
- Channel IDs must not encode provider names or provider-specific identifiers.

### Source Selection

- A channel source points at cataloged local media from the media catalog slice.
- The first implementation may represent a source as one media root, a subset of media items, or a simple catalog query, but it must not require Plex or Jellyfin.
- Disabled or unavailable media items should not make channel configuration invalid by themselves.
- A channel with an empty source can be saved, but later scheduling should report that it has no schedulable media.

### Playback Mode

MVP playback modes:

- `chronological`
- `random`

Chronological means schedule generation should later preserve a deterministic order based on normalized catalog ordering or explicit episode metadata when available.

Random means schedule generation should later use deterministic seeded selection, not process-global randomness.

This spec stores the chosen playback mode but does not define the full schedule-generation algorithm.

### API

The API should expose endpoints equivalent to:

```text
GET /channels
POST /channels
GET /channels/:id
PATCH /channels/:id
DELETE /channels/:id
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

API validation should reject invalid channel numbers, empty names, duplicate active channel numbers, and unsupported playback modes.

### Persistence

- SQLite stores channel configuration.
- Channel configuration survives API restarts.
- Channel rows should use timestamps for creation and updates.
- Source selection should be persisted in a way that can evolve beyond the first source type.

## Data Model Impact

Minimum channel fields:

```text
Channel
id
number
name
enabled
playbackMode
sourceType
sourceConfig
createdAt
updatedAt
```

Initial playback mode values:

- `chronological`
- `random`

Initial source type values:

- `media_root`
- `media_items`

`sourceConfig` should be treated as channel configuration, not scheduling output. Schedule entries and playout timeline items belong to later specs.

## Architecture Boundaries

This slice affects:

- Schedule: indirectly, by providing channel configuration used by later schedule generation.
- Playout timeline: indirectly, by providing channel identity used by later timelines.
- Channel state: indirectly, by defining configured channels that can later have runtime state.
- kraziBrain: owns provider-neutral channel configuration concepts and future scheduling interpretation.
- SignalPackager: not directly.
- Provider adapters: not directly.

Important boundaries:

- Channel configuration must not include Plex, Jellyfin, or Emby-specific fields.
- Channel configuration must not include FFmpeg command options.
- `apps/server` owns HTTP validation, route registration, and persistence wiring.
- `packages/core` may define provider-neutral channel types and validation rules.
- `packages/media` owns media catalog/probe concepts, not channel scheduling decisions.
- Provider adapters may later map channel config into provider-specific outputs without modifying core channel identity.

## Open Questions

- Should channel numbers be integers only, or should subchannels such as `69.1` be allowed?
- Should disabled channels reserve their channel numbers?
- Should a channel source initially point to media roots, explicit media item IDs, or both?
- Should channel deletion be hard delete or soft delete?
- Should logos be included in MVP channel configuration or deferred until Plex guide polish?

## Acceptance Criteria

- A channel can be created with number, name, enabled state, playback mode, and source selection.
- Configured channels can be listed through the API.
- A single channel can be fetched through the API.
- Channel configuration can be updated through the API.
- A channel can be disabled without deleting it.
- A channel can be deleted.
- Channel configuration persists across API restarts.
- Duplicate active channel numbers are rejected.
- Unsupported playback modes are rejected.
- Channel configuration does not require Plex, Jellyfin, FFmpeg, schedule generation, playout timeline generation, or streaming.

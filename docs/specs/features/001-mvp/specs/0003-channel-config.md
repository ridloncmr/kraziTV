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
- Allow a channel to select a media collection as its programming source.
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
- Media collection selection

Example channel:

```text
Channel 69
Name: Krazi Comedy
Playback mode: Chronological
Collection: Comedy Shows
Enabled: true
```

The user can list configured channels and see whether each channel is enabled, what collection it uses, and what playback mode it will use when schedules are generated.

Disabling a channel keeps its configuration but excludes it from future guide, provider, and playout behavior.

Deleting a channel removes the channel configuration. Future implementation may preserve historical playback data, but the MVP does not require that history.

## Technical Behavior

### Channel Identity

- Each channel has a stable internal `id`.
- Each channel has a user-visible `number`.
- Each channel has a user-visible `name`.
- Channel numbers must be unique among active configured channels.
- Channel IDs must not encode provider names or provider-specific identifiers.

### Programming Collection Selection

- A channel programming source points at a media collection.
- A media collection is a logical set of cataloged media items that are eligible for programming on a channel.
- A media root represents filesystem scope and must not be used directly as channel programming intent.
- The first implementation may support simple collections backed by explicit media item IDs.
- Disabled or unavailable media items should not make channel configuration invalid by themselves.
- A channel with an empty collection can be saved, but later scheduling should report that it has no schedulable media.

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
- Collection selection should be persisted in a way that can evolve beyond the first collection type.

## Data Model Impact

Minimum channel fields:

```text
Channel
id
number
name
enabled
playbackMode
mediaCollectionId
createdAt
updatedAt
```

Initial playback mode values:

- `chronological`
- `random`

Minimum media collection fields:

```text
MediaCollection
id
name
createdAt
updatedAt
```

Minimum collection membership fields:

```text
MediaCollectionItem
mediaCollectionId
mediaItemId
createdAt
```

Schedule entries and playout timeline items belong to later specs.

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

Media roots and media collections are separate concepts:

- Media roots answer where kraziTV can discover media.
- Media collections answer what media a channel or programming rule can select.
- Channels should reference media collections, not filesystem roots, for programming eligibility.

## Open Questions

- Should channel numbers be integers only, or should subchannels such as `69.1` be allowed?
- Should disabled channels reserve their channel numbers?
- Should the first media collection editor support explicit item IDs only, or also simple catalog filters?
- Should channel deletion be hard delete or soft delete?
- Should logos be included in MVP channel configuration or deferred until Plex guide polish?

## Acceptance Criteria

- A channel can be created with number, name, enabled state, playback mode, and media collection selection.
- Media collections can be created from explicit cataloged media item IDs.
- Configured channels can be listed through the API.
- A single channel can be fetched through the API.
- Channel configuration can be updated through the API.
- A channel can be disabled without deleting it.
- A channel can be deleted.
- Channel configuration persists across API restarts.
- Duplicate active channel numbers are rejected.
- Unsupported playback modes are rejected.
- Channel programming eligibility is based on media collections, not direct filesystem roots.
- Channel configuration does not require Plex, Jellyfin, FFmpeg, schedule generation, playout timeline generation, or streaming.

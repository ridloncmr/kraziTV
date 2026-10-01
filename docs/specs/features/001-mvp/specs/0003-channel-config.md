# Channel Configuration

Status: Accepted

This spec defines the MVP channel configuration slice: creating media collections, creating channels, assigning stable channel identity, and managing the channel lifecycle, including administrative runtime shutdown.

A channel is a broadcast identity only. What a channel plays, and how, lives in
its programming blocks, which spec 0004 defines
([ADR 0009](../../../../adrs/0009-programming-blocks.md)).

## Problem

kraziTV needs user-defined channels before it can generate schedules, playout timelines, guide data, or provider-facing channel lists. A channel is the viewer-facing broadcast identity, but its configuration must stay provider-neutral so Plex, Jellyfin, and future adapters can expose the same channel without changing core scheduling rules.

Programming blocks also need media collections to draw from. The MVP needs
explicit, ordered collections without premature support for automatic
collections, commercials, seasonal rules, or provider-specific options.

## Goals

- Let users create, list, update, enable, disable, and delete channels.
- Define how disabling or deleting a channel affects its active runtime worker.
- Let users create, list, update, and delete media collections backed by explicit media item membership.
- Assign each channel a stable internal identifier.
- Require a channel number and display name.
- Persist channel and media collection configuration in SQLite.
- Keep channel configuration provider-neutral.
- Provide enough channel data for later programming blocks, schedule generation, playout timeline generation, and Plex exposure.

## Non-Goals

- Do not define programming blocks, playback modes, or playback progress; spec
  0004 owns them.
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

Example channel:

```text
Channel 69
Name: Krazi Comedy
Enabled: true
```

The user can list configured channels and see each channel's number, name, and
enabled state. The channel's programming is configured separately as a
programming block (spec 0004).

A user can create a media collection, such as "The Office" or "Halloween
Movies", from an explicit ordered list of cataloged media items.

Disabling a channel keeps its configuration but excludes it from future guide,
provider, and playout behavior. If the channel has an active or idle-grace
stream worker, disabling it is also an operational shutdown: new subscriptions
are rejected, current subscriber streams are closed, pending worker creation is
cancelled, and the worker is stopped without waiting for idle grace.

Deleting a channel permanently removes its configuration, programming blocks,
playback progress, schedule entries, and schedule state. It applies the same immediate runtime shutdown policy as
disabling. It does not delete media collections or catalog items. Soft deletion
and historical playback retention are deferred.

## Technical Behavior

### Channel Identity

- Each channel has a stable internal `id`.
- Each channel has a user-visible `number`.
- Each channel has a user-visible `name`.
- Channel numbers must be unique among all configured channels, including disabled channels.
- Channel numbers are stored as canonical strings containing a positive integer major number and an optional positive integer subchannel, such as `69` or `69.1`.
- Channel numbers must match `[1-9][0-9]*(\.[1-9][0-9]*)?`; whitespace, signs, leading zeroes, and multiple decimal separators are rejected.
- Channel IDs must not encode provider names or provider-specific identifiers.
- A channel carries no programming fields such as a media collection or
  playback mode.

### Media Collections

- A media collection is an ordered set of cataloged media items that programming blocks can draw from.
- A media root represents filesystem scope and must not be used directly as programming intent.
- The first implementation supports ordered collections backed by explicit media item IDs.
- Each membership has a zero-based `position` that is unique within its collection.
- Collection replacement requests define the complete item order. The server stores contiguous positions in request order.
- Collection order is the order chronological playback follows. The catalog does not need to infer season or episode metadata.
- Missing or `probe_failed` media items may be collection members; they do not make the collection invalid by themselves.
- An empty collection can be saved.
- How a collection was built is invisible to its consumers. Automatic
  collections are deferred and will populate the same ordered membership.

### API

The channel API should expose endpoints equivalent to:

```text
GET /channels
POST /channels
GET /channels/:id
PATCH /channels/:id
DELETE /channels/:id
```

The media collection API should expose endpoints equivalent to:

```text
GET /media-collections
POST /media-collections
GET /media-collections/:id
PATCH /media-collections/:id
DELETE /media-collections/:id
GET /media-collections/:id/items
PUT /media-collections/:id/items
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

Collection creation should require a non-empty name. Collection membership updates replace the full explicit ordered item set for the MVP. Duplicate media item IDs in one collection are rejected.

API validation should reject invalid channel numbers, empty channel or collection names, duplicate channel numbers, and unknown media item IDs in collection membership.

### Persistence

- SQLite stores channel and media collection configuration.
- Channel and collection configuration survives API restarts.
- Channel and collection rows use timestamps for creation and updates.
- Media collection membership is persisted separately from media roots and media catalog rows.
- Once spec 0004 adds programming blocks, deleting a media collection that a
  programming block references is rejected until the block changes source.

### Active Worker Lifecycle

Every stream subscription validates that the channel still exists and is
enabled inside its serialized per-channel manager transition and immediately
before it attaches to an existing worker or participates in creating a new one.
This check is required even when a worker is already registered.

After a disable or delete mutation commits, `apps/server` tells
`ChannelStreamManager` to stop that channel for reason `disabled` or `deleted`
and awaits completion before returning a successful administrative response.
The per-channel manager transition cancels pending creation, prevents a racing
subscription from publishing or joining a worker, closes all subscriber
streams, stops the SignalPackager session, and terminates its FFmpeg process.
Administrative shutdown bypasses idle grace but retains the normal bounded
child-process termination grace.

Persistence is committed before runtime shutdown begins. Therefore a
subscription racing the operation observes either the old enabled state and is
then closed by the serialized stop, or the new disabled/missing state and is
rejected. If the process exits between those steps, process shutdown removes the
worker. The successful API response is not sent until runtime cleanup settles.

If runtime cleanup fails after persistence commits, the server must not roll the
configuration mutation back or return a normal success response. It returns
`503 Service Unavailable` with a structured error equivalent to:

```json
{
  "code": "channel_runtime_cleanup_failed",
  "channelId": "channel-id",
  "operation": "disable",
  "persistenceCommitted": true,
  "retryable": true
}
```

`operation` is `disable` or `delete`. The response and administrative UI must
make clear that the configuration change already committed and that retrying is
for runtime cleanup, not for reversing or repeating the persistence mutation.
The failure is logged with the cleanup phase, stop reason, channel ID, and child
process information when available.

Disable and delete retries are idempotent operational-stop requests. Setting an
already-disabled channel to disabled again must still call `stopChannel()` even
when persistence is a no-op. `DELETE /channels/:id` is idempotent for runtime
cleanup: if configuration is already absent, the route still calls
`stopChannel(id, "deleted")` and returns success once cleanup settles. Therefore
a delete retry also succeeds for an ID that never existed; `GET` retains normal
not-found behavior.

The manager retains an unsettled per-channel lifecycle record, including any
child-process handle, after cleanup failure. The record remains non-joinable,
blocks worker replacement, and is removed only after a later stop attempt or
server shutdown confirms that the worker, SignalPackager session, subscribers,
preparations, and child processes have settled. A partial stop is retried from
its remaining unsettled resources rather than recreating resources or treating a
missing active-worker registration as success. No persistent cleanup-pending
field or automatic background retry is required for the MVP.

Re-enabling a disabled channel while its manager lifecycle record is still
unsettled must first retry and complete the prior operational stop. The server
must not commit `enabled: true` while old runtime resources remain. If cleanup
still fails, the channel stays disabled and the re-enable request returns the
same retryable cleanup error.

Re-enabling a disabled channel permits the next subscription to create a fresh
worker; it does not resurrect the old process or subscriber streams. Changes to
name or number, programming blocks, collection membership, or other ordinary
programming inputs do not force an operational shutdown. Schedule regeneration and revision
revalidation preserve the current broadcast under their existing policy.

## Data Model Impact

Minimum channel fields:

```text
Channel
id
number
name
enabled
createdAt
updatedAt
```

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
position
createdAt
```

Programming blocks, playback progress, schedule entries, and playout timeline
items belong to later specs.

## Architecture Boundaries

This slice affects:

- Schedule: indirectly, by providing the channels and media collections that later programming blocks and schedule generation use.
- Playout timeline: indirectly, by providing channel identity used by later timelines.
- Channel state: indirectly, by defining configured channels that can later have runtime state.
- kraziBrain: owns provider-neutral channel configuration concepts and future scheduling interpretation.
- SignalPackager: not directly.
- Provider adapters: not directly.

Important boundaries:

- Channel configuration must not include Plex, Jellyfin, or Emby-specific fields.
- Channel configuration must not include FFmpeg command options.
- `apps/server` owns HTTP validation, route registration, and persistence wiring.
- `apps/server` coordinates committed channel disable/delete mutations with the
  per-channel runtime stop, returns a structured retryable `503` when cleanup
  fails after commit, and does not return success before cleanup settles.
- `packages/core` may define provider-neutral channel types and validation rules.
- `packages/media` owns media catalog/probe concepts, not channel scheduling decisions.
- Provider adapters may later map channel config into provider-specific outputs without modifying core channel identity.

Media roots and media collections are separate concepts:

- Media roots answer where kraziTV can discover media.
- Media collections answer what media a programming block can select.
- Programming blocks reference media collections or single media items, never
  filesystem roots.

## Deferred Work

- Channel logos are deferred until Plex guide polish.
- Automatic, rule-based, and query-backed collections are deferred to the
  programming feature set (ADR 0009 extension path).
- Historical playback retention and soft deletion are deferred.

## Acceptance Criteria

- A channel can be created with number, name, and enabled state, and carries no
  programming fields.
- Media collections can be created from an explicit ordered list of cataloged media item IDs.
- Media collections can be listed, fetched, updated, and deleted through the API.
- Media collection membership can be replaced through the API using an explicit order without duplicate media item IDs.
- Configured channels can be listed through the API.
- A single channel can be fetched through the API.
- Channel configuration can be updated through the API.
- A channel can be disabled without deleting it.
- A channel can be deleted.
- Disabling or deleting an active channel rejects new subscriptions, closes
  existing subscriber streams, cancels pending creation, and stops the worker
  without idle grace before the administrative request succeeds.
- A subscription racing disable/delete cannot attach to or publish a worker
  after the committed channel state becomes disabled or missing.
- Cleanup failure after commit returns a retryable
  `channel_runtime_cleanup_failed` error that explicitly reports
  `persistenceCommitted: true`; the persisted disable/delete remains in effect.
- Repeating disable for an already-disabled channel and repeating delete for an
  absent channel both retry the operational stop and succeed once runtime
  resources settle.
- A failed administrative stop retains its non-joinable lifecycle record and
  resource handles until retry or server shutdown completes cleanup.
- Re-enabling cannot commit while a prior administrative stop still owns
  unsettled runtime resources.
- Re-enabling a channel allows a later subscription to create a fresh worker.
- Channel and media collection configuration persists across API restarts.
- Duplicate channel numbers are rejected, including numbers assigned to disabled channels.
- Integer and subchannel numbers are accepted in canonical string form; malformed or non-canonical numbers are rejected.
- Channel configuration remains provider-neutral and does not construct FFmpeg,
  schedule, or playout behavior; active disable/delete operations coordinate
  with the separately owned streaming runtime lifecycle.

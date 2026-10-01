# Spec 0003 Implementation Plan: Channel Configuration

Status: Implemented on 2026-10-01; all tickets (CH-001 through CH-006) complete

Source: [`docs/specs/features/001-mvp/specs/0003-channel-config.md`](../specs/features/001-mvp/specs/0003-channel-config.md)

This plan delivers persistent media collections, channel identity, and the
channel lifecycle, including the administrative runtime stop that disable and
delete require. Channels carry no programming fields; programming blocks and
playback progress belong to spec 0004
([ADR 0009](../adrs/0009-programming-blocks.md)).

## Delivery Strategy

Work proceeds in three bands:

1. Persist ordered media collections and expose them over HTTP. This is the
   first feedback loop and depends only on the implemented catalog.
2. Add canonical channel numbers in `packages/krazi-brain`, then persist channels and
   expose channel CRUD.
3. Coordinate committed disable and delete mutations with the channel runtime
   through the existing `ChannelStreamManagerContract`, then close acceptance.

Each ticket leaves the repository buildable and testable. Tests use temporary
SQLite databases and Fastify injection, following the plan 0002 conventions.

## Architecture and Ownership

```text
apps/server
  media-collections/   collection repository and routes
  channels/            channel repository, routes, runtime stop coordination
  database/            migrations and row types
        |
        +---- packages/krazi-brain   channel number parsing and channel types
        |
        `---- packages/signal ChannelStreamManagerContract (type only)
```

- `packages/krazi-brain` owns provider-neutral channel types and canonical channel
  number parsing. Move the existing `Channel` type and `describeChannel` out of
  `src/index.ts` into `src/channels/` so the package follows the `AGENTS.md`
  source layout.
- `apps/server` owns migrations, repositories, request validation, HTTP error
  mapping, and the ordering of persistence commit before runtime stop.
- `apps/server` depends on `packages/signal` only for the
  `ChannelStreamManagerContract` type in this plan. Composing a real manager is
  plan 0006 work.
- Programming blocks, playback modes, schedules, Plex output, and Web Admin
  screens are outside this plan.

## Resolved Implementation Policies

The following policies close questions the spec leaves to implementation:

- IDs are opaque text generated with `crypto.randomUUID()` behind an injectable
  `createId`, as in the media-root repository.
- Timestamps are stored as integer UTC epoch milliseconds and serialized as ISO
  8601 strings at the HTTP boundary.
- Errors use the existing `{ "error": { "code", "message" } }` envelope. The
  runtime cleanup failure adds `channelId`, `operation`,
  `persistenceCommitted`, and `retryable` inside `error`.
- New error codes:

  | Code                             | Status | When                                                   |
  | -------------------------------- | ------ | ------------------------------------------------------ |
  | `channel_not_found`              | 404    | `GET` or `PATCH` on an unknown channel                 |
  | `channel_number_duplicate`       | 409    | Create or update collides with any channel's number    |
  | `media_collection_not_found`     | 404    | Unknown collection on any collection route             |
  | `media_item_not_found`           | 400    | Membership names an unknown media item (existing code) |
  | `channel_runtime_cleanup_failed` | 503    | Runtime stop failed for disable, delete, or re-enable  |

- Channel lists are ordered by major number, then subchannel (absent first),
  then ID. Collection lists are ordered by case-folded name, then ID.
- Channel and collection names are trimmed, must be non-empty, and are not
  unique.
- `POST /media-collections` accepts a name and an optional ordered
  `mediaItemIds` array. `PUT /media-collections/:id/items` replaces the full
  membership. Duplicate IDs are `400 invalid_request`.
- `GET /media-collections/:id/items` returns each membership's position with a
  media item summary (ID, title, status, duration) so the Web Admin can show
  whether a collection has schedulable media without a second request.
- Deleting a collection always succeeds in this plan because nothing references
  collections yet. Spec 0004 adds the restricting reference from programming
  blocks.
- Until plan 0006 composes the real manager, production injects a no-op
  channel runtime whose `stopChannel()` resolves immediately. That is accurate,
  not a stub: no stream workers can exist before SIG-014.
- Re-enable retries the prior stop before committing. If that stop fails, the
  channel stays disabled and the response is `channel_runtime_cleanup_failed`
  with `operation: "disable"` (the stop being retried) and
  `persistenceCommitted: false`.

## Schema Invariants

Migration `002_media_collections`:

- `media_collections`: text `id` primary key, `name`, `created_at`,
  `updated_at`.
- `media_collection_items`: `media_collection_id` references
  `media_collections` with `ON DELETE CASCADE`; `media_item_id` references
  `media_items`; `position` is a non-negative integer; `created_at`.
  `(media_collection_id, position)` and `(media_collection_id, media_item_id)`
  are unique. `media_item_id` has its own index for item-side lookups.
- Follow migration `001_initial_catalog`: every timestamp is checked as a safe
  non-negative integer, `name` is checked non-empty after trimming, and
  `position` is checked as a non-negative integer.

Migration `003_channels`:

- `channels`: text `id` primary key, `number` unique and checked against the
  canonical pattern, `name`, `enabled` as a checked integer boolean,
  `created_at`, `updated_at`.

Membership replacement deletes and reinserts a collection's rows in one
transaction and writes contiguous positions in request order.

## Dependency and Decision Gates

| Gate                      | Required before                 | Exit condition                                                                 |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| G1: collections persisted | collection API                  | Collections and ordered membership persist with enforced constraints.          |
| G2: channel identity      | runtime stop coordination       | Channels persist with canonical, unique numbers and full CRUD over HTTP.       |
| G3: administrative stop   | declaring spec 0003 implemented | Disable, delete, and re-enable follow the spec's commit-then-stop contract.    |
| G4: executable acceptance | spec 0004 and SIG-012 / SIG-015 | Workspace checks pass and acceptance covers every spec criterion and restarts. |

## Phase 1: Media Collections

### CH-001: Persist media collections and ordered membership

**Status**

Complete on 2026-10-01. Migration `002_media_collections` and
`MediaCollectionRepository` persist collections and ordered membership with
schema, repository, chunked-write, and reopen tests; HTTP exposure is CH-002.

**Goal**

Store collections and their explicit item order so later programming blocks have
something to draw from.

**Scope**

- Add migration `002_media_collections` and row types per the schema
  invariants.
- Add `MediaCollectionRepository` with create (optionally with members), list,
  find by ID, rename, delete, list members, and replace members.
- Return typed outcomes such as `not_found` and `unknown_media_items` instead of
  throwing for expected cases.

**Out of scope**

- HTTP routes, programming block references, and automatic collections.

**Blocking dependencies**

- None. The catalog schema from plan 0002 is in place.

**Implementation notes**

- Validate member existence inside the replacing transaction so a concurrent
  change cannot leave a dangling member; the foreign key is the final guard.
- Media items are never deleted by the catalog, so membership stays valid when
  an item goes `missing`.
- Duplicate media item IDs are a caller error, not a typed outcome. CH-002
  rejects them before the repository runs; if one slips through, the unique
  `(media_collection_id, media_item_id)` constraint throws and the transaction
  rolls back.
- Listing members returns, in position order, each member's position plus the
  media item summary CH-002 serves (ID, title, status, duration), joined in one
  query so the route does not reshape rows.
- Sort collections by name case-folded in JS with a fixed-locale
  `Intl.Collator("en", { sensitivity: "base" })`, then by ID, so the order
  does not depend on the host locale. SQLite `lower()` folds only ASCII.
- The repository stores names as given. Trimming and the non-empty rule belong
  to CH-002 route validation, as with media roots; the check constraint is the
  final guard.

**Verification**

- Repository tests cover create, rename, delete with cascade, empty
  membership, full replacement with contiguous positions, unknown item
  rejection, and duplicate rejection by constraint.
- Schema tests prove the unique and check constraints reject invalid rows.
- Members survive closing and reopening the database.

**Docs impact**

- None.

### CH-002: Expose the media collection API

**Status**

Complete on 2026-10-01. `registerMediaCollectionRoutes` serves all seven
collection routes with strict Zod validation and the planned error codes;
`POST` returns `201`, `DELETE` returns `204`, `GET /:id` returns the collection
without members, and `PUT /:id/items` returns the replaced membership.

**Goal**

Let a client create, list, fetch, rename, delete, and reorder collections.

**Scope**

- Register `GET`/`POST /media-collections`,
  `GET`/`PATCH`/`DELETE /media-collections/:id`, and
  `GET`/`PUT /media-collections/:id/items`.
- Validate bodies with strict Zod schemas and map outcomes to the error codes
  above.
- Inject the repository through `ServerDependencies`.

**Out of scope**

- Web Admin forms and programming block references.

**Blocking dependencies**

- CH-001.

**Implementation notes**

- Keep validation and status mapping in the route file, as the media-root
  routes do.
- Reuse the media item projection shape for member summaries rather than
  exposing raw rows.

**Verification**

- Fastify injection tests cover every route, empty name, duplicate and unknown
  member IDs, unknown collection, and reorder.

**Docs impact**

- None.

## Phase 2: Channel Identity

### CH-003: Add canonical channel numbers to `packages/krazi-brain`

**Status**

Complete on 2026-10-01. `packages/krazi-brain/src/channels/` holds `Channel`
(now with `enabled`), `describeChannel`, `parseChannelNumber` (returns the
canonical number or `undefined`), and `compareChannelNumbers`, which compares
digit strings so oversized major numbers still order exactly. `ChannelNumber`
is a branded string, so the CH-004 repository must produce it through
`parseChannelNumber` when reading rows. `apps/server` now depends on and
references the package; the ID tiebreak for channel lists is left to the CH-004
repository.

**Goal**

Give every layer one definition of a valid channel number and one channel type.

**Scope**

- Move `Channel` and `describeChannel` into `packages/krazi-brain/src/channels/` and
  add `enabled` to `Channel`.
- Add `parseChannelNumber()` accepting `[1-9][0-9]*(\.[1-9][0-9]*)?` and a
  comparator for list ordering.
- Add `@krazitv/krazi-brain` as an `apps/server` dependency and build reference.

**Out of scope**

- Persistence and HTTP.

**Blocking dependencies**

- None. May run in parallel with Phase 1.

**Implementation notes**

- Keep the export surface to the type, parser, comparator, and
  `describeChannel`.

**Verification**

- Unit tests accept `69` and `69.1` and reject whitespace, signs, leading
  zeroes, `69.0`, multiple separators, and empty input.
- Comparator tests order `2`, `10`, `10.1`, `10.2`, and `11` numerically.

**Docs impact**

- None.

### CH-004: Persist channels and expose channel CRUD

**Status**

Complete on 2026-10-01. Migration `003_channels` (canonical numbers enforced
with `GLOB` checks) and `ChannelRepository` back all five `/channels` routes;
`POST` defaults `enabled` to `true`, an empty `PATCH` body is rejected, and
an update that changes no value leaves `updatedAt` alone. Unique numbers make
the planned ID tie-breaker in list order unnecessary, so it was dropped.
Disable and delete change persistence only until CH-005 adds the runtime stop.

**Goal**

Let a client create, list, fetch, update, enable, disable, and delete channels.

**Scope**

- Add migration `003_channels`, row types, and `ChannelRepository`.
- Register `GET`/`POST /channels` and `GET`/`PATCH`/`DELETE /channels/:id`.
- Allow `PATCH` to change number, name, and enabled state.
- Return `channel_number_duplicate` for collisions, including with disabled
  channels.

**Out of scope**

- Runtime stop coordination, which CH-005 adds; until then disable and delete
  only change persistence.
- Programming blocks and schedule data.

**Blocking dependencies**

- CH-003.

**Implementation notes**

- The unique constraint is the final duplicate guard; a precheck may only
  improve the message.
- `DELETE` on an absent channel returns success, matching the spec's idempotent
  delete, while `GET` returns `channel_not_found`.

**Verification**

- Injection tests cover create, list order, fetch, partial update, duplicate
  numbers including disabled channels, malformed numbers, empty names, unknown
  IDs, and repeated delete.
- Channels survive closing and reopening the server.

**Docs impact**

- None.

## Phase 3: Lifecycle and Acceptance

### CH-005: Coordinate disable, delete, and re-enable with the channel runtime

**Status**

Complete on 2026-10-01. The channel routes take a `ChannelRuntime`
(`Pick<ChannelStreamManagerContract, "stopChannel">`); production injects
`noOpChannelRuntime`. Disable and delete commit, then await the stop, and a
failure returns the structured `503` with the change kept. Re-enable always
retries the `disabled` stop first, because no cleanup-pending state is
persisted, and a failure also refuses any other change in that request. An
in-process `ChannelLifecycleLock` serializes `PATCH` and `DELETE` per channel
so no change lands between a re-enable's stop and commit; each stop has a
deadline (30 s by default, `channelStopTimeoutMs` in `buildServer` options)
after which the request gets the retryable `503` and the lock is freed, so a
hung stop cannot block the channel's later requests. The manager now tags
cleanup failures with `phase` (`worker_startup` or `worker_stop`), and the
failure log records the channel ID, operation, stop reason, phase, and each
cause's code and details, which carry FFmpeg process information.

**Goal**

Make administrative changes stop a channel's stream runtime under the spec's
commit-then-stop contract.

**Scope**

- Inject a channel runtime typed as
  `Pick<ChannelStreamManagerContract, "stopChannel">`; production composes the
  no-op runtime described above.
- After a disable or delete commits, await `stopChannel(id, reason)` before
  responding.
- Map a stop failure to `503 channel_runtime_cleanup_failed` with
  `persistenceCommitted: true` and log the phase, reason, and channel ID.
- Call `stopChannel()` again when disable targets an already-disabled channel or
  delete targets an absent one.
- Before committing `enabled: true` on a disabled channel, retry the prior stop
  and keep the channel disabled if it fails.
- Leave name and number changes free of runtime calls.

**Out of scope**

- Composing a real `ChannelStreamManager`, channel authorization, and server
  shutdown ordering (plan 0006 SIG-012, SIG-014, SIG-015).

**Blocking dependencies**

- CH-004.

**Implementation notes**

- Never roll back a committed mutation after a stop failure.
- Use a fake runtime in tests that records calls and can fail on demand.

**Verification**

- Tests prove the response waits for the stop, that stop runs after commit,
  that a failed stop returns the structured `503` with the mutation still in
  effect, that retries call the stop again and succeed, that re-enable is
  refused while the stop fails, and that rename and renumber never call it.

**Docs impact**

- None. The spec already documents the response.

### CH-006: Close executable acceptance and hand off

**Status**

Complete on 2026-10-01. `channels/channel-acceptance.test.ts` drives
collections and channels through the HTTP API, restarts on the same data
directory, and confirms persistence, the disable and delete runtime stops, and
that channel rows and responses hold only identity fields. The re-enable
fresh-worker row stays with SIG-015.

**Goal**

Prove every spec 0003 acceptance criterion against the real server composition
and hand off to spec 0004 and plan 0006.

**Scope**

- Add an acceptance test that drives collections and channels through the HTTP
  API, restarts on the same data directory, and confirms persistence.
- Confirm channel rows and responses contain no provider, FFmpeg, or
  programming fields.
- Mark spec 0003 `Implemented` and record this plan's status.

**Out of scope**

- Real stream workers; plan 0006 verifies the stop against running processes.

**Blocking dependencies**

- CH-002 and CH-005.

**Verification**

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
  Prettier pass.
- The traceability table below has a passing test for every row, except the
  rows assigned to SIG-015, which plan 0006 verifies.

**Docs impact**

- Update the spec 0003 status in the MVP feature README and this plan's status
  in `docs/implementation_plan/README.md`.

## Hand-off

| Consumer  | Relies on                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Spec 0004 | `channels` and `media_collections` tables; adds programming blocks that cascade on channel delete and restrict collection delete. |
| SIG-012   | `channels.enabled` and existence for `ChannelAuthorization`.                                                                      |
| SIG-015   | CH-005 route coordination; replaces the no-op runtime with the composed manager and verifies real cleanup.                        |

## Acceptance-Criteria Traceability

| Spec behavior                                                        | Primary tickets                 |
| -------------------------------------------------------------------- | ------------------------------- |
| Channel created with number, name, enabled and no programming fields | CH-003, CH-004                  |
| Collections created from an explicit ordered item list               | CH-001, CH-002                  |
| Collections listed, fetched, updated, and deleted                    | CH-002                          |
| Membership replaced in explicit order without duplicates             | CH-001, CH-002                  |
| Channels listed, fetched, updated, disabled, and deleted             | CH-004                          |
| Disable/delete stop the runtime before success                       | CH-005                          |
| Racing subscription cannot attach after commit                       | SIG-007 (done), CH-005 ordering |
| Cleanup failure returns retryable 503 with committed persistence     | CH-005                          |
| Repeated disable/delete retry the stop                               | CH-004, CH-005                  |
| Failed stop retains its lifecycle record                             | SIG-007 (done)                  |
| Re-enable blocked while a prior stop is unsettled                    | CH-005                          |
| Re-enable lets a later subscription create a fresh worker            | SIG-007 (done), SIG-015         |
| Configuration persists across restarts                               | CH-001, CH-004, CH-006          |
| Duplicate and malformed channel numbers rejected                     | CH-003, CH-004                  |
| Provider-neutral configuration                                       | CH-006                          |

# 0003 Materialized Schedule Entries

## Status

Accepted

## Context

kraziTV's guide, derived playout timeline, channel state, and stream selection must resolve consistently from the same guide-visible programming. These remain distinct domain concepts, but they cannot disagree about which scheduled program applies at a given time. Regenerating schedule windows on demand can make overlapping queries disagree, especially once random playback is supported.

For example, a request for 12:00-18:00 and a later request for 15:00-21:00 must return the same programming in the overlapping period.

## Decision

kraziTV will persist generated `ScheduleEntry` records.

Schedule generation will extend a future horizon for enabled channels. Persisted entries are the authority for guide output and the shared scheduling input from which kraziBrain derives the playout timeline and channel state. Stream selection uses that derived channel state.

Configuration changes must not silently change what is currently airing. Regeneration begins at the current program end. When nothing is airing, it begins at the current UTC Unix epoch millisecond and replaces future entries from that boundary. Initial generation begins at the persisted schedule anchor.

Horizon maintenance extends schedules without replacing entries in already-covered windows. It runs when the server starts, when a channel becomes enabled or its scheduling inputs change, after a catalog scan makes a channel schedulable, and before guide, channel-state, or stream requests that require coverage. An enabled, schedulable channel with no entry covering the current time requires an explicit, logged gap repair before normal horizon extension continues.

Catalog availability changes do not rewrite published schedule entries. Channel-state lookup reports unavailable media explicitly instead of silently selecting a replacement.

Every mutation of a channel's materialized schedule runs in one SQLite write
transaction. The transaction acquires database write authority before reading
the schedule and `ChannelScheduleState`, re-evaluates the required work, and
atomically commits entry changes with state such as `lastGeneratedThrough` and
`nextSequenceNumber`. `ChannelScheduleState` also stores a monotonic
`scheduleRevision`. Every transaction that changes the persisted entry set,
ordering, or contents increments the revision exactly once in the same commit;
a no-op coverage check does not increment it. Concurrent requests must serialize
through the database; an in-process lock alone is insufficient.

With the selected Kysely `SqliteDialect`, schedule mutations use the
project-owned, connection-pinned immediate-transaction helper defined by ADR 0004. The helper executes `BEGIN IMMEDIATE` before reading the schedule or
`ChannelScheduleState`; ordinary Kysely `db.transaction()` is deferred on
SQLite and does not satisfy this invariant. Failure to acquire write authority
must retry the entire mutation from fresh state or return a retryable error.

Derived channel-state and playout selections carry the revision from the same
consistent snapshot as their source schedule entries. Active channel stream
workers may prefetch and prepare future selections, but those preparations are
revocable. At or after a scheduled boundary, a worker uses the same
connection-pinned immediate-transaction helper as schedule mutation, revalidates
the entry and current persisted revision, and synchronously commits the prepared
SignalPackager item before releasing write authority. That commit is the point
at which the item becomes irrevocable. A regeneration transaction that commits
first invalidates the stale preparation; a transition that commits first makes
the entry current, so later regeneration preserves it through its scheduled end.

The database enforces a unique `(channelId, sequenceNumber)` constraint and one
schedule-state row per channel. Indexes on `(channelId, startsAt)` and
`(channelId, endsAt)` support overlap, current-entry, and horizon queries.

## Consequences

- Guide responses remain stable across restarts and overlapping API requests.
- The playout timeline, channel state, and stream output can resolve from the same schedule entries Plex sees without collapsing those concepts into the schedule.
- Schedule regeneration needs explicit policy and logging.
- Schedule mutation failures roll back both materialized entries and their
  associated schedule state.
- Concurrent schedule requests cannot reserve the same sequence number or commit
  overlapping extensions from stale state.
- Multi-connection integration tests prove that schedule mutations acquire
  SQLite write authority before their first domain read.
- Active stream workers cannot treat prefetched future programming as
  authoritative after the materialized schedule revision changes.
- Schedule regeneration and broadcast transition commitment have a deterministic
  order at the SQLite write-authority boundary.
- Following-item commits briefly acquire SQLite write authority even though they
  do not change the materialized schedule; the synchronous commit keeps that
  coordination window bounded.
- The database carries schedule data, not only channel configuration and media catalog data.

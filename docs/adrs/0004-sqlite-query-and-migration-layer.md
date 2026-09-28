# 0004 SQLite Query and Migration Layer

## Status

Accepted

## Context

kraziTV uses SQLite for local persistence. Persistence-heavy MVP slices need tables and migrations for media roots, media items, ordered media-collection membership, channels, schedule entries, and channel schedule state. MVP playout items and channel state are derived rather than persisted separately.

The project considered Drizzle and Kysely. Choosing Kysely alone does not select
the SQLite dialect or its underlying database driver, so those choices also need
to be explicit.

## Decision

Use Kysely as the TypeScript query layer for SQLite persistence. Configure it
with Kysely's `SqliteDialect` backed by `better-sqlite3`.

Use Kysely migrations for schema changes. Keep migration files readable and explicit, and avoid hiding the schema behind broad repository abstractions before the persistence model stabilizes.

Kysely's built-in `SqliteDriver` currently starts transactions with plain
`BEGIN`, which SQLite treats as deferred. Ordinary `db.transaction()` therefore
does not satisfy a requirement to acquire write authority before the first
read.

Schedule read-modify-write mutations use a project-owned immediate-transaction
helper. The helper obtains a Kysely instance pinned to one connection, executes
`BEGIN IMMEDIATE` before invoking domain work, runs every mutation query through
that pinned instance, and explicitly commits or rolls back on the same
connection. It must not be nested or mixed with Kysely-managed transactions.

Read-only repository operations that derive channel state or selected playout
use an ordinary Kysely transaction. They read `scheduleRevision` first to
establish the SQLite snapshot and perform every subsequent source query through
the transaction-bound Kysely instance. They must not use the root database
handle inside the callback. If a read determines that schedule coverage must be
mutated, it ends and returns a retry condition; the caller performs the mutation
through the immediate-transaction helper and reruns the whole read operation.

Do not wrap async Kysely work in `better-sqlite3`'s synchronous
`transaction(...).immediate()` API. If a future Kysely release adds supported
SQLite transaction modes, the helper may be replaced only while retaining the
same concurrency tests and `BEGIN IMMEDIATE` semantics.

## Consequences

- Persistence-heavy MVP work can proceed without agents choosing between Drizzle and Kysely per slice.
- All SQLite-backed slices use the same dialect and driver rather than selecting
  a persistence stack independently.
- Specs can continue to define tables and relationships in provider-neutral terms without using Kysely syntax.
- `apps/server` should own database connection and migration wiring unless a later package boundary becomes necessary.
- `apps/server` owns the `better-sqlite3` connection lifecycle and passes that
  connection to Kysely's `SqliteDialect`.
- `apps/server` owns the narrow immediate-transaction helper used by schedule
  persistence. Domain code receives its scoped persistence interface rather
  than issuing transaction-control SQL.
- Ordinary Kysely `db.transaction()` is not sufficient for schedule mutations
  that must own SQLite write authority before reading.
- Ordinary Kysely `db.transaction()` is the standard for multi-query read-only
  schedule snapshots; mutation and read-snapshot helpers remain separate so a
  deferred read is never upgraded into a write.
- Domain packages should receive typed data or narrow persistence interfaces instead of importing Kysely directly by default.
- If future schema needs strongly favor another migration or ORM layer, that change should get a new ADR rather than reopening this one casually.

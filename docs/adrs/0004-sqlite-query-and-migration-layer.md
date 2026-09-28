# 0004 SQLite Query and Migration Layer

## Status

Accepted

## Context

kraziTV uses SQLite for local persistence. Persistence-heavy MVP slices need tables and migrations for media roots, media items, ordered media-collection membership, channels, schedule entries, and channel schedule state. MVP playout items and channel state are derived rather than persisted separately.

The project considered Drizzle and Kysely.

## Decision

Use Kysely as the TypeScript query layer for SQLite persistence.

Use Kysely migrations for schema changes. Keep migration files readable and explicit, and avoid hiding the schema behind broad repository abstractions before the persistence model stabilizes.

## Consequences

- Persistence-heavy MVP work can proceed without agents choosing between Drizzle and Kysely per slice.
- Specs can continue to define tables and relationships in provider-neutral terms without using Kysely syntax.
- `apps/server` should own database connection and migration wiring unless a later package boundary becomes necessary.
- Domain packages should receive typed data or narrow persistence interfaces instead of importing Kysely directly by default.
- If future schema needs strongly favor another migration or ORM layer, that change should get a new ADR rather than reopening this one casually.

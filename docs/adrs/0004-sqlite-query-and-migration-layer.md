# 0004 SQLite Query and Migration Layer

## Status

Proposed

## Context

kraziTV uses SQLite for local persistence. The project has not yet chosen the TypeScript query and migration layer.

Current candidates include Drizzle and Kysely.

## Decision

No final decision yet.

The chosen layer should support typed queries, readable migrations, local SQLite development, and straightforward test setup.

## Consequences

- Implementation should avoid deep persistence abstractions until this decision is accepted.
- Specs can define tables and relationships without committing to library-specific syntax.
- Before persistence-heavy MVP work begins, this ADR should be updated to Accepted with the selected tool and rationale.

# Architecture Decision Records

Architecture decision records document important technical choices.

## Records

| ADR                                                  | Status   | Decision                                                     |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------ |
| [0001](0001-typescript-node-stack.md)                | Accepted | Use Node.js and TypeScript as the primary application stack  |
| [0002](0002-plex-hdhomerun-tuner-emulation.md)       | Accepted | Plex integration uses HDHomeRun-compatible tuner emulation   |
| [0003](0003-materialized-schedule-entries.md)        | Accepted | Generated schedule entries are materialized and persisted    |
| [0004](0004-sqlite-query-and-migration-layer.md)     | Accepted | Use Kysely with `SqliteDialect` and `better-sqlite3`         |
| [0005](0005-signal-packager-package-boundary.md)     | Accepted | SignalPackager has a dedicated package boundary              |
| [0006](0006-media-roots-and-collections.md)          | Accepted | Media roots and media collections are separate concepts      |
| [0007](0007-integer-millisecond-time.md)             | Accepted | Use integer milliseconds for internal and persisted time     |
| [0008](0008-shared-active-channel-stream-workers.md) | Accepted | Use at most one shared stream worker per channel             |
| [0009](0009-programming-blocks.md)                   | Accepted | Programming blocks sit between channels and schedule entries |
| [0010](0010-source-layout.md)                        | Accepted | Group source files by capability inside domain folders       |
| [0011](0011-shared-process-package.md)               | Accepted | Child-process spawning lives in a shared `process` package   |

## Format

Each ADR should include:

- Status
- Context
- Decision
- Consequences

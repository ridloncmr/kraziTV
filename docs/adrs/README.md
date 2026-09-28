# Architecture Decision Records

Architecture decision records document important technical choices.

## Records

| ADR                                              | Status   | Decision                                                    |
| ------------------------------------------------ | -------- | ----------------------------------------------------------- |
| [0001](0001-typescript-node-stack.md)            | Accepted | Use Node.js and TypeScript as the primary application stack |
| [0002](0002-plex-hdhomerun-tuner-emulation.md)   | Accepted | Plex integration uses HDHomeRun-compatible tuner emulation  |
| [0003](0003-materialized-schedule-entries.md)    | Accepted | Generated schedule entries are materialized and persisted   |
| [0004](0004-sqlite-query-and-migration-layer.md) | Accepted | Use Kysely for SQLite queries and migrations                |
| [0005](0005-signal-packager-package-boundary.md) | Accepted | SignalPackager has a dedicated package boundary             |
| [0006](0006-media-roots-and-collections.md)      | Accepted | Media roots and media collections are separate concepts     |

## Format

Each ADR should include:

- Status
- Context
- Decision
- Consequences

# Architecture Decision Records

Architecture decision records document important technical choices.

## Records

Each ADR's status is the `## Status` section of the ADR itself.

| ADR                                                    | Decision                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| [0001](0001-typescript-node-stack.md)                  | Use Node.js and TypeScript as the primary application stack        |
| [0002](0002-plex-hdhomerun-tuner-emulation.md)         | Plex integration uses HDHomeRun-compatible tuner emulation         |
| [0003](0003-materialized-schedule-entries.md)          | Generated schedule entries are materialized and persisted          |
| [0004](0004-sqlite-query-and-migration-layer.md)       | Use Kysely with `SqliteDialect` and `better-sqlite3`               |
| [0005](0005-signal-packager-package-boundary.md)       | SignalPackager has a dedicated package boundary                    |
| [0006](0006-media-roots-and-collections.md)            | Media roots and media collections are separate concepts            |
| [0007](0007-integer-millisecond-time.md)               | Use integer milliseconds for internal and persisted time           |
| [0008](0008-shared-active-channel-stream-workers.md)   | Use at most one shared stream worker per channel                   |
| [0009](0009-programming-blocks.md)                     | Programming blocks sit between channels and schedule entries       |
| [0010](0010-source-layout.md)                          | Group source files by capability inside domain folders             |
| [0011](0011-shared-process-package.md)                 | Child-process spawning lives in a shared `process` package         |
| [0012](0012-first-party-session-auth.md)               | Administration uses first-party sessions, not an identity provider |
| [0013](0013-metadata-provider-calls-and-stored-key.md) | Only `media` calls TMDB; its token is stored as a gated secret     |
| [0014](0014-planned-filler-coverage.md)                | Planned filler is derived coverage with its own playout cursor     |
| [0015](0015-scheduled-interruption.md)                 | A reservation may cut the airing item seamlessly at its start      |
| [0016](0016-prepared-ffmpeg-process.md)                | A prepared item's FFmpeg process starts ahead and holds its output |
| [0017](0017-series-folder-and-folder-evidence.md)      | The series folder names a show and its seasons break title ties    |
| [0018](0018-join-backlog.md)                           | A tuned viewer joins about ten seconds behind the live edge        |
| [0019](0019-same-origin-web-app-and-container.md)      | The server serves the built web app; one image holds everything    |

## Format

Each ADR should include:

- Status
- Context
- Decision
- Consequences

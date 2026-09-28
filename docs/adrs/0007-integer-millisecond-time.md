# 0007 Integer Millisecond Time

## Status

Accepted

## Context

ffprobe reports durations that may include fractional seconds. Schedule generation
repeatedly adds media durations across a months-long timeline, and channel state
subtracts wall-clock instants to calculate join-in-progress offsets. Floating-point
seconds would allow rounding error to accumulate and would leave persisted column
units ambiguous.

## Decision

Use integer milliseconds as the authoritative internal and persisted time unit.

- Durations and offsets use unit-bearing names such as `durationMs`, `offsetMs`,
  and `startOffsetMs`.
- Instants are UTC Unix epoch milliseconds represented as integers. Semantic names
  such as `startsAt`, `endsAt`, and `createdAt` remain valid when their type or
  schema establishes that representation.
- ffprobe duration output is converted once to the nearest whole millisecond at
  the media boundary. Invalid, non-finite, or non-positive results are rejected.
- Schedule and playout arithmetic uses only integer milliseconds.
- API and provider boundaries may serialize instants as UTC ISO 8601 strings when
  required by their contracts.
- SignalPackager converts millisecond offsets and durations to decimal-second
  strings only while constructing FFmpeg arguments.

TypeScript code should use explicit time aliases or otherwise preserve unit-bearing
field names. Persistence code must validate values as safe integers before writing
them to SQLite `INTEGER` columns.

## Consequences

- Fractional media durations retain millisecond precision without accumulating
  floating-point error across schedule entries.
- Persisted time values have one unambiguous unit and sort numerically.
- Internal contracts do not mix seconds and milliseconds silently.
- Boundary adapters own any ISO 8601 or decimal-second conversion required by
  HTTP, XMLTV, FFmpeg, or another external system.
- Sub-millisecond precision is intentionally discarded at media ingestion.

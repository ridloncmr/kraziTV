# 0011 Shared Child-Process Package

## Status

Accepted on 2026-10-01. Amended on 2026-10-05: the per-consumer allowance
covers every test double and fixture, not only the fake process, and the
package holds the shared stderr summary and diagnostic truncation. The server
also reuses the safe-integer option checks.

## Context

`packages/signal` spawns FFmpeg and `packages/media` spawns ffprobe. Both need
the same child-process port: spawn an executable directly without a shell,
expose stdout and stderr, and settle only after the child and its streams
close.

Signal had the port first. Media could not import it, because the catalog
must not depend on the streaming package ([ADR 0005](0005-signal-packager-package-boundary.md)).
Media copied the code instead, with a note to extract a package later. The
copies drifted in request shape and wording, then were made byte-identical.
Identical copies kept in sync only by a comment double every fix and rely on
someone remembering to apply both.

## Decision

- Create `packages/process` (`@krazitv/process`) holding the child-process
  port (`ProcessSpawner`, `SpawnedProcess`, and their types) and its Node
  implementation, `NodeProcessSpawner`. It also holds tool-neutral child
  lifecycle helpers both consumers need: `terminateProcess` (SIGTERM, then
  one SIGKILL escalation, with injectable timers), `OutputTail` (bounded
  retention of the newest output bytes), and `summarizeStderr` (the last
  sanitized stderr line, with caller-named values redacted), and
  `truncateDiagnosticText` (the length cap every stored or logged diagnostic
  shares).
- It also holds the safe-integer option checks media and signal apply to their
  timeouts, grace periods, and limits, moved from `packages/signal` under the
  no-copy rule below once media needed the same check. The server reuses them
  for its own runtime options rather than keeping a third copy.
- `packages/media` and `packages/signal` depend on `@krazitv/process`. Neither
  depends on the other.
- `packages/process` knows nothing about FFmpeg, ffprobe, media, or signals.
  Tool-specific arguments, timeouts, and error mapping stay in the consuming
  package.
- Each consumer keeps its own test doubles and fixtures in `src/testing/`,
  such as its fake process or MPEG-TS packet builder, because `src/testing/`
  is not part of any package's build. Repeating a test helper this way is
  allowed. A repeat the codebase audit detects is recorded in
  `audit-exceptions.json` with this ADR as its source.
- When code is needed by more than one package, move it into a package both
  depend on. Do not copy it.

## Consequences

- A fix to process spawning lands once and reaches both FFmpeg and ffprobe.
- The workspace gains one small package, with the usual `package.json`,
  `tsconfig.json`, `tsconfig.build.json`, and build reference.
- The package boundaries in ADR 0005 still hold; this adds a lower-level
  package beneath `media` and `signal` rather than moving responsibilities
  between them.

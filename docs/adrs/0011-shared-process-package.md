# 0011 Shared Child-Process Package

## Status

Accepted on 2026-10-01.

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
  implementation, `NodeProcessSpawner`.
- `packages/media` and `packages/signal` depend on `@krazitv/process`. Neither
  depends on the other.
- `packages/process` knows nothing about FFmpeg, ffprobe, media, or signals.
  Tool-specific arguments, timeouts, and error mapping stay in the consuming
  package.
- Each consumer keeps its own fake process in `src/testing/`, because test
  doubles are not part of any package's build.
- When code is needed by more than one package, move it into a package both
  depend on. Do not copy it.

## Consequences

- A fix to process spawning lands once and reaches both FFmpeg and ffprobe.
- The workspace gains one small package, with the usual `package.json`,
  `tsconfig.json`, `tsconfig.build.json`, and build reference.
- The package boundaries in ADR 0005 still hold; this adds a lower-level
  package beneath `media` and `signal` rather than moving responsibilities
  between them.

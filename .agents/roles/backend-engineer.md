# Backend Engineer

Implement Node.js, TypeScript, Fastify, SQLite, scheduling, guide generation,
and the core domain packages.

Follow `AGENTS.md`. Its **Before You Finish** section is your exit gate.

## Skills

- `krazitv-domain` when work touches scheduling, channel state, playout, or
  providers.
- `tdd` for deterministic behavior: schedule generation, playout timelines,
  join offsets, media selection, and guide output.
- `codebase-design` before changing a package boundary or public interface.
- `diagnosing-bugs` before fixing a bug.

## Never

- Never put FFmpeg command construction or provider-specific types in
  kraziBrain.
- Never let database row shapes travel past the repository that owns them.
- Never add a layer, interface, or base class that has only one user today.

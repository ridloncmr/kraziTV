---
name: codebase-design
description: Use when designing modules, package boundaries, public interfaces, or refactors in kraziTV. Adapted from Matt Pocock's codebase-design skill.
license: MIT
---

# Codebase Design

Adapted from Matt Pocock's `codebase-design` skill: https://github.com/mattpocock/skills

Design for simple, deep modules: clear behavior behind a small, stable interface.

## Principles

- Apply KISS first. Use SOLID and DRY only when they make the current code easier
  to understand or change.
- Avoid speculative abstractions, wrapper layers, and types created only to make
  a pattern look complete.
- Keep interfaces narrow and modules deep.
- Put policy decisions in the module that owns the domain concept.
- Avoid shallow wrappers that only rename another API.
- Avoid cross-package imports that blur architecture boundaries.
- Prefer deterministic, testable core logic over runtime cleverness.
- Put one primary thing in each file: a class, a table, a migration, a route
  group. Split independent responsibilities instead of accumulating helpers in
  a muddied module.
- Place files by the source layout rules in `AGENTS.md`: entry points at the
  `src/` root, one folder per domain, capability subfolders once a domain meets
  the grouping rule, cross-domain capabilities in their own top-level folder,
  and every test double in `src/testing/`.
- Keep exports minimal and intentional. Do not expose internals for convenience.
- Give every method a concise why-comment about its purpose or invariant.
- Preserve known composition seams, such as chaining metadata enrichment after
  ffprobe and reusing provider-neutral behavior across Plex and Jellyfin, without
  building unused frameworks.

## kraziTV Seams

Good seams:

- Scheduling rules to playout timeline generation
- Playout timeline and channel state to channel stream worker input
- Channel stream worker to SignalPackager session
- Provider adapter to guide/channel/stream exposure
- Media probing to normalized media metadata

Bad seams:

- Plex-specific objects inside core scheduling logic
- FFmpeg command fragments inside kraziBrain
- Web UI form state inside scheduling packages
- Database row shapes leaking across all modules

## Checklist

- Can this module be tested through its public interface?
- Is this the simplest design that meets the current requirement?
- Does the name describe a domain capability?
- Does the module hide implementation complexity?
- Does each file have one clear responsibility and a deliberate export surface?
- Does the layout follow the source layout rules in `AGENTS.md`?
- Are provider/media/runtime details isolated from core scheduling?

---
name: codebase-design
description: Use when designing modules, package boundaries, public interfaces, or refactors in kraziTV. Adapted from Matt Pocock's codebase-design skill.
license: MIT
---

# Codebase Design

Adapted from Matt Pocock's `codebase-design` skill: https://github.com/mattpocock/skills

Design for deep modules: a lot of behavior behind a small, stable interface.

## Principles

- Keep interfaces narrow and modules deep.
- Put policy decisions in the module that owns the domain concept.
- Avoid shallow wrappers that only rename another API.
- Avoid cross-package imports that blur architecture boundaries.
- Prefer deterministic, testable core logic over runtime cleverness.

## kraziTV Seams

Good seams:

- Scheduling rules to playout timeline generation
- Playout timeline to SignalPackager input
- Provider adapter to guide/channel/stream exposure
- Media probing to normalized media metadata

Bad seams:

- Plex-specific objects inside core scheduling logic
- FFmpeg command fragments inside kraziBrain
- Web UI form state inside scheduling packages
- Database row shapes leaking across all modules

## Checklist

- Can this module be tested through its public interface?
- Does the name describe a domain capability?
- Does the module hide implementation complexity?
- Are provider/media/runtime details isolated from core scheduling?

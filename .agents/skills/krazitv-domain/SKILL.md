---
name: krazitv-domain
description: Use when working on kraziTV domain behavior, kraziBrain, SignalPackager, schedules, playout timelines, channel state, Plex/Jellyfin providers, or architecture boundaries.
---

# kraziTV Domain

Use this skill whenever work touches kraziTV's core product model.

## Core Model

Read `GLOSSARY.md` for the definitions of kraziBrain, SignalPackager, provider
adapter, channel stream worker, schedule, playout timeline, channel state, and
the other shared terms. Do not redefine them here.

## Boundaries

- kraziBrain decides what plays, when it plays, and why.
- One active channel owns one broadcast signal.
- Viewers subscribe to the shared channel signal.
- The shared channel signal advances at wall-clock speed independently of viewer backpressure.
- Channel stream workers manage active broadcast lifecycle and subscriber fan-out.
- SignalPackager decides how selected media becomes a continuous stream.
- Provider adapters decide where streams and guide data are exposed.

Do not leak Plex or Jellyfin assumptions into kraziBrain.

Do not put programming rules in SignalPackager.

Do not create independent programming or encoding sessions per viewer for the same active channel.

Do not put FFmpeg command construction in kraziBrain.

## MVP Rules

Support first:

- Plex
- Local media
- One or more channels
- Basic Web UI
- Simple schedule generation
- Random and chronological playback
- Continuous channel state
- HDHomeRun-compatible channel exposure and XMLTV guide output
- FFmpeg MPEG-TS output

Avoid first:

- Commercials
- Jellyfin implementation
- Advanced transcoding profiles
- Seasonal rules
- Theme programming
- AI programming decisions

## Documentation Placement

- Product behavior belongs in feature-scoped specs under `docs/specs/features/`.
- Architecture decisions belong in `docs/adrs/`.
- Build sequencing belongs in `docs/implementation_plan/`.
- Research belongs in `docs/knowledge_base/`.

Specs and plans guide work before and during implementation. After a behavior is
implemented, its source and executable tests are canonical; completed documents
remain historical context.

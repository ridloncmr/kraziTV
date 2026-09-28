---
name: krazitv-domain
description: Use when working on kraziTV domain behavior, kraziBrain, SignalPackager, schedules, playout timelines, channel state, Plex/Jellyfin providers, or architecture boundaries.
---

# kraziTV Domain

Use this skill whenever work touches kraziTV's core product model.

## Core Model

- Schedule: What viewers see in the guide.
- Playout timeline: Everything actually transmitted by a channel.
- Channel state: Deterministic runtime state that lets viewers join a broadcast in progress.
- kraziBrain: Scheduling and playout decision engine.
- SignalPackager: Streaming and media normalization layer.
- Provider adapter: Plex/Jellyfin/Emby-specific integration layer.

## Boundaries

- kraziBrain decides what plays, when it plays, and why.
- SignalPackager decides how selected media becomes a continuous stream.
- Provider adapters decide where streams and guide data are exposed.

Do not leak Plex or Jellyfin assumptions into kraziBrain.

Do not put programming rules in SignalPackager.

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

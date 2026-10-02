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

Read **Core Architecture Boundaries** in `AGENTS.md` before changing behavior,
and name which component owns each decision in your change. When a change
seems to need a component to cross its boundary, stop and raise it instead of
working around it.

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

## Authority

Where docs go and which ones are canonical is in `AGENTS.md` under **Authority
And Documentation Lifecycle** and **Documentation Rules**. For implemented
behavior, source and executable tests win over specs and plans.

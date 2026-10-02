# 0005 SignalPackager Package Boundary

## Status

Accepted

## Context

SignalPackager is a first-class architectural boundary. It owns how selected media becomes a stream, while kraziBrain owns what plays and why.

Keeping FFmpeg lifecycle, transcoding, muxing, stream continuity, seeking, and packaging under `packages/media` would blur media inspection with media playback.

## Decision

Create `packages/signal` as the home for SignalPackager code.

Package responsibilities:

- `packages/media`: media discovery, filesystem inspection, ffprobe, source metadata.
- `packages/krazi-brain`: scheduling, kraziBrain, channel rules, playback history, timeline generation.
- `packages/signal`: FFmpeg lifecycle, transcoding, muxing, stream continuity, seeking, packaging, encoding profiles.
- `packages/plex`: HDHomeRun compatibility, Plex-facing metadata, XMLTV integration, tuner endpoints.

## Consequences

- FFmpeg streaming concerns have a dedicated module from the start.
- `packages/media` stays focused on inspecting media rather than playing it.
- Provider adapters can depend on a narrow stream contract instead of constructing FFmpeg commands.
- Future stream features can grow without pulling scheduling logic into packaging code.

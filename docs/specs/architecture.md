# Architecture

kraziTV is organized around three main responsibilities:

- kraziBrain decides what plays, when it plays, and why it was selected
- SignalPackager decides how selected media becomes a continuous stream
- Provider adapters decide where the stream and guide data are exposed

## High-Level Flow

```text
Web UI
  |
  v
kraziBrain
  |
  | Playout timeline
  v
SignalPackager
  |
  | Continuous TV signal
  v
Provider adapters
  |
  v
Plex / Jellyfin
```

## Design Boundary

kraziBrain should not know about FFmpeg command construction, codecs, containers, or provider-specific behavior.

SignalPackager should not know why a file was selected.

Provider adapters should not leak Plex or Jellyfin assumptions into the core scheduling model.

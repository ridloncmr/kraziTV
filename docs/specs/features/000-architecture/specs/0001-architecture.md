# Architecture

Status: Accepted

kraziTV is organized around four main responsibilities:

- kraziBrain decides what plays, when it plays, and why it was selected
- Channel stream workers own the active broadcast lifecycle for watched channels
- SignalPackager decides how selected media becomes a continuous stream
- Provider adapters decide where the stream and guide data are exposed

## High-Level Flow

```text
Configuration and exposure:

Web UI ----> apps/server ----> kraziBrain
kraziBrain ---- schedule / guide data ----> provider adapters
provider adapters ---- tuner / guide / stream URL ----> Plex / Jellyfin

Tune and stream:

Plex / Jellyfin ---- tune request ----> apps/server stream endpoint
                                             |
                                             v
                                    ChannelStreamManager
                                             |
                                             v
kraziBrain ---- selected playout ----> ChannelWorker
                                             |
                                             v
                                      SignalPackager
                                             |
                                             | shared MPEG-TS
                                             v
                                    subscribed viewers
```

Provider adapters expose tuner metadata, guide data, and provider-neutral stream URLs. They are not in the MPEG-TS byte path. Plex or another client initiates the tune request against the provider-neutral stream endpoint.

## Design Boundary

kraziBrain should not know about FFmpeg command construction, codecs, containers, or provider-specific behavior.

SignalPackager should not know why a file was selected.

Channel stream workers should not choose programming, generate schedules, or mutate guide data. They receive selected playout items from kraziBrain-owned logic and manage the active broadcast signal.

Provider adapters should not leak Plex or Jellyfin assumptions into the core scheduling model.

An active channel owns at most one shared broadcast signal. Viewers subscribe to the channel's active signal; they do not create independent channel broadcasts.

## Package Boundaries

```text
packages/media
  media discovery
  filesystem inspection
  ffprobe
  source metadata

packages/krazi-brain
  kraziBrain scheduling and playout decisions
  channel rules
  playback history
  timeline generation

packages/signal
  ChannelStreamManager
  ChannelWorker
  subscriber fan-out
  late-join stream initialization
  FFmpeg lifecycle
  transcoding
  muxing
  stream continuity
  seeking
  packaging
  encoding profiles

packages/plex
  HDHomeRun compatibility
  Plex-facing metadata
  XMLTV integration
  tuner endpoints
```

Useful shorthand:

```text
media = inspect things
core = decide things
signal = operate active broadcasts
plex = expose things
```

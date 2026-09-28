# MVP Feature

Status: Accepted

This feature folder contains the goal and vertical-slice specs for the first usable kraziTV release.

## Related Specs

| Spec                                | Status      | Description                                                            |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `specs/0001-bootstrap.md`           | Implemented | Local startup, health checks, and workspace verification               |
| `specs/0002-media-catalog.md`       | Draft       | Local media roots, scanning, ffprobe metadata, and catalog persistence |
| `specs/0003-channel-config.md`      | Draft       | Channel creation, configuration, and media collection selection        |
| `specs/0004-schedule-generation.md` | Draft       | Deterministic guide schedule generation from cataloged media           |
| `specs/0005-playout-timeline.md`    | Draft       | Runtime timeline and current broadcast position                        |
| `specs/0006-signal-packager.md`     | Draft       | FFmpeg MPEG-TS stream packaging for selected media                     |
| `specs/0007-plex-adapter.md`        | Draft       | Plex-compatible discovery, guide, playlist, and stream exposure        |
| `specs/0008-web-admin.md`           | Draft       | Minimal browser flow for configuring and observing the MVP             |

The first release should intentionally be small and focused on proving the core loop.

Before the full MVP chain, run a hard-coded Plex compatibility spike that exposes HDHomeRun-compatible tuner endpoints and proves Plex can discover one channel and play one stream.

## Scope

Support:

- Plex
- One or more channels
- Local media
- Simple schedule generation
- Random playback
- Chronological playback
- Continuous channel state
- Basic Web UI
- Basic guide data
- FFmpeg MPEG-TS output

Do not initially build:

- Commercials
- Jellyfin
- Seasonal rules
- Theme programming
- Advanced transcoding profiles
- Manual interrupts
- Complex media tagging
- AI-based programming
- Dynamic advertisements

## Success Criteria

```text
1. Start kraziTV.
2. Prove Plex accepts kraziTV as a tuner through the compatibility spike.
3. Create a channel.
4. Select a media collection.
5. Configure the channel.
6. Open Plex.
7. Navigate to Live TV.
8. Select the kraziTV channel.
9. See the currently-running program.
10. Tune in halfway through an episode.
11. Receive the stream from approximately the correct broadcast position.
12. Remain connected when the stream crosses into the next scheduled program.
```

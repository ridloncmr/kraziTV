# MVP Feature

Status: Accepted

This feature folder contains the goal and vertical-slice specs for the first usable kraziTV release.

## Related Specs

| Spec                                | Status      | Description                                                            |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `specs/0001-bootstrap.md`           | Implemented | Local startup, health checks, and workspace verification               |
| `specs/0002-media-catalog.md`       | Draft       | Local media roots, scanning, ffprobe metadata, and catalog persistence |
| `specs/0003-channel-config.md`      | Draft       | Channel creation, configuration, and source selection                  |
| `specs/0004-schedule-generation.md` | Planned     | Deterministic guide schedule generation from cataloged media           |
| `specs/0005-playout-timeline.md`    | Planned     | Runtime timeline and current broadcast position                        |
| `specs/0006-signal-packager.md`     | Planned     | FFmpeg MPEG-TS stream packaging for selected media                     |
| `specs/0007-plex-adapter.md`        | Planned     | Plex-compatible discovery, guide, playlist, and stream exposure        |
| `specs/0008-web-admin.md`           | Planned     | Minimal browser flow for configuring and observing the MVP             |

The first release should intentionally be small and focused on proving the core loop.

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
2. Create a channel.
3. Select a media collection.
4. Configure the channel.
5. Open Plex.
6. Navigate to Live TV.
7. Select the kraziTV channel.
8. See the currently-running program.
9. Tune in halfway through an episode.
10. Receive the stream from approximately the correct broadcast position.
```

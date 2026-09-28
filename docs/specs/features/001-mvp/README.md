# MVP Feature

Status: Accepted

This feature folder contains the goal and vertical-slice specs for the first usable kraziTV release.

## Related Specs

| Spec                                | Status      | Description                                                            |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `specs/0001-bootstrap.md`           | Implemented | Local startup, health checks, and workspace verification               |
| `specs/0002-media-catalog.md`       | Accepted    | Local media roots, scanning, ffprobe metadata, and catalog persistence |
| `specs/0003-channel-config.md`      | Accepted    | Channel creation, configuration, and media collection selection        |
| `specs/0004-schedule-generation.md` | Accepted    | Deterministic guide schedule generation from cataloged media           |
| `specs/0005-playout-timeline.md`    | Accepted    | Runtime timeline and current broadcast position                        |
| `specs/0006-signal-packager.md`     | Draft       | Shared active-channel streaming and FFmpeg MPEG-TS packaging           |
| `specs/0007-plex-adapter.md`        | Draft       | Plex-compatible tuner, guide, and stream exposure                      |
| `specs/0008-web-admin.md`           | Accepted    | Minimal browser flow for configuring and observing the MVP             |

The first release should intentionally be small and focused on proving the core loop.

Before the full MVP chain, run a hard-coded Plex compatibility spike that exposes HDHomeRun-compatible tuner endpoints and proves Plex can discover one channel, share one active channel worker across two viewers, allow a late viewer to join an already-running stream, keep the broadcast paced to wall-clock time, and keep playing across an actual two-file stream boundary. Record the verified HDHomeRun response fields, FFmpeg pacing and continuity strategy, late-join behavior, subscriber buffering limits, and idle-grace behavior in the SignalPackager and Plex adapter specs before changing either spec to `Accepted`.

ADR 0004 is accepted. Persistence-heavy MVP slices consistently use Kysely with
`SqliteDialect` and `better-sqlite3` for SQLite queries and migrations.

## Scope

Support:

- Plex
- One or more channels
- Local media
- Simple schedule generation
- Random playback
- Chronological playback
- Continuous channel state
- Shared active-channel streaming
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
12. Confirm one ChannelWorker and one FFmpeg pipeline start for the watched channel.
13. Confirm the broadcast remains aligned with wall-clock time.
14. Tune a second Plex viewer to the same channel.
15. Confirm the second viewer joins the existing ChannelWorker and does not start a second FFmpeg pipeline.
16. Remain connected when the stream crosses into the next scheduled program.
17. Confirm Plex remains playing for both viewers across an actual two-file boundary.
18. Disconnect one viewer and confirm the other continues unaffected.
19. Disconnect the final viewer and confirm the ChannelWorker stops after the idle grace period.
```

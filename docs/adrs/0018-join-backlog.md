# 0018 A Tuned Viewer Joins About Ten Seconds Behind The Live Edge

## Status

Accepted on 2026-10-23. Replaces two MVP defaults
[spec 0006](../specs/features/001-mvp/specs/0006-signal-packager.md) selected
from the compatibility spike: late joins replaying from the newest PAT, and
input pacing with no startup burst. Keeps
[ADR 0008](0008-shared-active-channel-stream-workers.md)'s one shared signal
per channel and [ADR 0016](0016-prepared-ffmpeg-process.md)'s prepared
processes unchanged.

## Context

Every Plex tune froze on its first frame for about ten seconds, then played
without trouble ([issue #30](https://github.com/ridloncmr/kraziTV/issues/30)).
Plex's log for one tune: playing 5 s after the tune, then `buffering` for
10.6 s, then `playing` for good. Capturing the stream route showed why: a new
viewer, first or late, never held more than about 0.2 s of media ahead of
wall-clock time. Plex's player fills a buffer of roughly ten seconds before
it plays smoothly, and with nothing banked it could only fill at 1x speed.
Late joins also began mid-GOP, so up to a second of replay could not be
decoded.

## Decision

- **A joining viewer's replay starts about ten seconds back, on a
  keyframe.** The join point is the PAT before the tenth-newest video
  keyframe in the retained signal, or before the oldest one when less is
  retained. Each GOP is one second, so counting keyframes measures the
  backlog without reading timestamps, which restart with every FFmpeg
  process. Code name `JOIN_BACKLOG_MS`.
- **A session's first FFmpeg process bursts the backlog.** A program
  without a black tail starts up to the backlog earlier in its media, never
  before its start, and reads that span with `-readrate_initial_burst`
  before `-re` pacing applies. Its output runs that much longer, so the live
  edge stays on schedule and the item still ends at its boundary. Filler and
  black tails are paced by real-time filters, which would undo a burst, so
  a session starting on one starts without a backlog.
- **The first viewer's tune answers only once the backlog exists.** Plex
  starts playing on the first frames it receives and then stalls again to
  fill its buffer, so a backlog delivered while it builds played, stopped,
  then played. The session's first process is ready only after it has
  written one keyframe per second of its burst plus the one it starts on,
  or after 10 s with a keyframe written, so a slow encoder never holds a
  tune without bound. Plex waited out 6, 10, and 15 s tunes through its
  own tune API. The worker's startup timeout is therefore 12 s; its
  transition recovery window and write-authority wait keep 2 s, as
  separate settings.
- **A bursting first process encodes with x264's `veryfast` preset.** The
  tune waits on the burst, and `-tune zerolatency`'s sliced threading
  halved x264's speed; a burst reads its input at once, so the lookahead
  `zerolatency` removes costs nothing there. A first process with nothing
  to burst keeps `zerolatency`.
- **Retention holds the backlog, and each viewer's queue holds more.** The
  server retains 16 MiB, ten seconds up to about 12 Mbps, and allows each
  subscriber 32 MiB, so a queue that starts with a full replay is never cut
  off for it.

## Consequences

- Every viewer watches about ten seconds behind the schedule and guide.
  The schedule, transitions, and the live edge itself are unchanged.
- A late joiner receives the backlog at once. A cold start's tune takes
  about as long as FFmpeg needs to encode the backlog: on the reference
  machine, with another channel and Plex transcoding alongside, cold tunes
  answered after 2.7 to 2.9 s with 10.5 to 11.3 s of media. Because the
  schedule moves on during that wait, the first viewer of a cold channel
  watches that much further behind it than ten seconds.
- Spec 0006's initial tune drift is now measured at the live edge; the
  first output a viewer receives is up to the backlog older. Spec 0006's
  2,000 ms startup timeout no longer applies to the first process.
- Seeking within Plex restarts Plex's own transcoder, so it can still
  buffer; the backlog only covers the tune.
- Retained memory per active channel rises from 4 MiB to at most 16 MiB.

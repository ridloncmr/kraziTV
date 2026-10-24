# FFmpeg Real-Time Startup

## Question

Does FFmpeg real-time input pacing keep a newly started channel worker aligned
with the wall-clock schedule, including encoder startup latency?

## Findings

- `-readrate 1` limits FFmpeg to ingesting at most one second of media per
  second of wall-clock time. `-re` is equivalent to `-readrate 1`.
- Real-time input pacing controls ingestion rate after processing begins. It is
  not, by itself, evidence that time spent resolving state, spawning FFmpeg,
  opening the input, probing streams, initializing encoders, or producing the
  first decodable output has been recovered.
- `-readrate_initial_burst` permits an initial amount of input to be read before
  the read-rate limit is enforced.
- `-readrate_catchup` permits a faster ingestion rate after blocking causes the
  input to fall behind the configured primary read rate. Its value must be at
  least the primary read rate.
- The catch-up options describe input ingestion. Their effect on emitted
  MPEG-TS timing, decoder startup, and Plex behavior still requires an
  end-to-end compatibility test.
- FFmpeg can report machine-readable progress with `-progress`, but startup
  alignment must be measured from usable encoded output rather than process
  creation or a progress message alone.

## Sources

- [FFmpeg documentation: `-readrate`, `-re`, startup burst, catch-up, and progress](https://ffmpeg.org/ffmpeg.html)
- [FFmpeg demuxer source: read-rate defaults and validation](https://ffmpeg.org/doxygen/trunk/ffmpeg__demux_8c_source.html)

## Implications for kraziTV

- Resolve current channel state again as the final step before spawning the
  first worker process. Do not reuse state captured during earlier subscription
  or worker-creation work.
- Measure the difference between the scheduled media position at first usable
  output and the media position represented by that output.
- Keep the scheduled item end as an absolute wall-clock deadline. Startup delay
  must not extend the item and shift every later transition.
- Treat `-readrate 1` or `-re` as ongoing pacing, not startup synchronization.
- Use an initial burst or catch-up rate only if the compatibility spike verifies
  its emitted timing and Plex playback behavior.

## Encoder Lookahead (2026-10-23)

Under `-re`, x264's default frame lookahead dominates startup: the encoder
emits nothing until it has read about 1.6 s of media at wall-clock speed.
Measured on a 720p H.264 episode packaged to the 1080p program profile with
FFmpeg 6.1.1:

| x264 setting                       | First video output |
| ---------------------------------- | ------------------ |
| Default                            | 1.79 s             |
| `rc-lookahead=10:sync-lookahead=0` | 1.01 s             |
| `-tune zerolatency`                | 0.21 s             |

Through the stream route, a cold tune answered in 1.84 s against the 2,000 ms
startup timeout, so Plex tunes failed with a 503 whenever a start ran slightly
slow (Plex: "Could not tune channel. Please check your tuner or antenna.").
`zerolatency` raised bitrate about 44% on the same clip. The packager now uses
it for a session's first process only. A prepared process keeps lookahead,
because its prepare lead already hides startup, and a faster start would hold
more output ahead of the clock ([ADR 0016](../adrs/0016-prepared-ffmpeg-process.md)).

## Join Backlog (2026-10-23)

Plex froze every tune on its first frame for about ten seconds
([issue #30](https://github.com/ridloncmr/kraziTV/issues/30)): its player
fills a buffer of roughly ten seconds, and the stream route never held more
than about 0.2 s of media ahead of wall-clock time. Measured on FFmpeg 6.1.1:

- `-readrate_initial_burst` works together with `-re`: the burst span is
  read at once, then pacing resumes, and the live edge lands where it would
  have without the burst.
- The burst is delivered only as fast as FFmpeg encodes, and x264 is the
  limit: decoding 10 s of the 1080p HEVC test episode took 0.84 s. With
  `-tune zerolatency`, whose sliced threading replaces frame threading, the
  preset barely mattered (4.0 s at `medium`, 2.9 s at `superfast`). Without
  it, `veryfast` took 2.2 s. Under the real burst arguments, the eleventh
  keyframe arrived after 4.5 s with `zerolatency` and 2.6 s with
  `veryfast`; the first arrived after about 0.5 s with either.
- FFmpeg's MPEG-TS muxer writes a PAT and PMT immediately before every
  video keyframe and sets the random-access indicator on it. It also sets
  that indicator on every audio frame, so a keyframe search must check the
  video PID.
- After the change, a late joiner received 9.7 s of media within 0.5 s of
  the tune, and a Plex Android tune started playing about 4.5 s after the
  tune with no `buffering` state.

Delivering the burst while it builds was not enough: Plex played the first
frames, stalled for 5.5 s, then played on. Through Plex's tune API, the
server waited out a stream route that answered after 6, 10, and 15 s, each
tune succeeding. Holding a cold tune until the burst existed answered after
4.8 s with 10.3 s of media under `zerolatency`, and after 2.7 to 2.9 s under
`veryfast`.

kraziTV now gives every viewer about ten seconds of backlog, and holds a
cold tune until it exists ([ADR 0018](../adrs/0018-join-backlog.md)).

## Open Questions

- Whether late state resolution plus normal startup meets the 2,000 ms MVP
  initial-tune-drift ceiling on supported development hardware.
- Which FFmpeg/ffprobe capture analysis gives the most reliable first-decodable
  media-position measurement for the spike assets.

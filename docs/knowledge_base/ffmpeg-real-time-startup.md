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

## Open Questions

- Whether late state resolution plus normal startup meets the 2,000 ms MVP
  initial-tune-drift ceiling on supported development hardware.
- Whether a verified initial burst or catch-up rate is needed, and what exact
  arguments avoid receiver buffering or playback instability.
- Which FFmpeg/ffprobe capture analysis gives the most reliable first-decodable
  media-position measurement for the spike assets.

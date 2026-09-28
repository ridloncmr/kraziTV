# Child Process and Stream Safety

## Question

What baseline process and stream controls should kraziTV require for ffprobe and
FFmpeg work?

## Findings

- Node's `child_process.spawn()` accepts an executable and argument array without
  a shell. It supports cancellation, a millisecond timeout, and a kill signal.
- Sending a kill signal does not itself prove that a child has exited. Callers
  still need to observe process closure and escalate termination when necessary.
- ffprobe can emit JSON selected with explicit output and entry options, which is
  preferable to parsing human-oriented text.
- Node writable streams signal backpressure by returning `false` from `write()`.
  Producers must wait for `drain`, or use `pipe()`/`pipeline()` so backpressure is
  propagated automatically.
- Continuing to write while a destination is backpressured permits unbounded
  buffering and can exhaust process memory when a network client is slow.

## Sources

- [Node.js 22 child process documentation](https://nodejs.org/docs/latest-v22.x/api/child_process.html)
- [Node.js 22 stream documentation](https://nodejs.org/docs/latest-v22.x/api/stream.html)
- [ffprobe documentation](https://ffmpeg.org/ffprobe.html)

## Implications for kraziTV

- Spawn ffprobe and FFmpeg directly with structured arguments and `shell: false`.
- Put a timeout and bounded output capture around every ffprobe process.
- Limit concurrent probes with a worker pool.
- Confirm child closure after cancellation and escalate when a process does not
  exit during the grace period.
- Continuously drain FFmpeg stdout into the owning channel broadcaster so one
  HTTP client's backpressure cannot stall the shared channel signal.
- Fan broadcast output out through independent, bounded subscriber buffers.
  Disconnect a subscriber that exceeds its limit without stalling FFmpeg or
  other subscribers.
- While a worker is retained without subscribers during idle grace, continue
  draining its output. Discard unneeded bytes or retain only the explicitly
  bounded initialization buffer required for late join.
- Never accumulate MPEG-TS output in an unbounded application-owned buffer.

## Open Questions

- Whether FFmpeg process groups are needed for reliable descendant cleanup on all
  supported operating systems.
- Whether the initial output limits and termination grace period need tuning after
  observing real Plex and media-library failures.

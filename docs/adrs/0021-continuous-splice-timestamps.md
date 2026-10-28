# 0021 Splices Continue One Forward Timestamp Timeline

## Status

Accepted on 2026-10-28. Amends
[ADR 0016](0016-prepared-ffmpeg-process.md), whose splices rewrote only
continuity counters, and the splices
[ADR 0020](0020-failed-item-stand-in.md) adds into and out of a stand-in.

## Context

A signal session feeds one broadcast signal from successive FFmpeg
processes. Each process stamps its own output from about 1.4 s, so every
splice jumped PTS, DTS, and PCR backward. Plex and FFmpeg recover from a
backward jump: FFmpeg logs `DTS out of order` or `timestamp discontinuity`
and carries on, sometimes misplacing a frame or two after a briefly aired
item.

Browsers do not recover. A browser plays MPEG-TS through Media Source
Extensions, which place every frame by its timestamp. A prototype played
spliced kraziTV-style output through mpegts.js 1.8.2 in Chromium:

| Splice                                                     | Result                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Timestamps restart, as before                              | Picture froze at the first splice; later frames landed on time already played              |
| Shifted by item length, B-frame encodes                    | Froze: a B-frame encode's first DTS is a frame before its first PTS, so two frames overlap |
| Shifted so each stream starts one frame after its own last | Played through every splice, mixed presets and B-frames, with no frame dropped             |

mpegts.js stitches timestamps only at the start of each batch it remuxes,
so a jump inside a batch passes through. The fix has to be in the signal.

## Decision

- **Every splice continues one forward timeline.** Where packets reach the
  session's output, before continuity counters, `MpegTsTimestamps` shifts
  each process's PTS, DTS, and PCR by one offset, so the broadcast signal's
  timestamps only run forward.
- **The session marks each splice.** A commit, a stand-in taking over, and
  a stalled item resuming each call `splice()` before the new packets
  arrive. The first process keeps its own timestamps.
- **The offset is the least that puts every stream after its own last
  frame.** After a splice, the new process's packets are held until each
  stream that aired before has shown its first timestamp, or one stream has
  run half a second ahead of its own first timestamp. The offset then places every
  stream's first DTS and PTS at or after its last PES packet plus that
  stream's PES spacing, learned from the step between its last two, and
  measures PTS from the lowest one held, since a resumed item may return on
  a frame displayed after the B-frames that follow it. One offset for
  all streams keeps audio and video in sync; a stream that started later in
  its process gets a gap of that difference, which players fill.
- **Timestamps wrap at 2^33 as MPEG-TS defines.** Every comparison,
  including the choice between candidate offsets, is modular, so a session running past about 26.5 hours wraps like any
  broadcast.

## Consequences

- Browsers can play a channel's stream across program boundaries, filler,
  black tails, stand-ins, and resumes, which the TV desktop program needs.
- FFmpeg no longer logs backward jumps at splices, and the frames it
  misplaced after a briefly aired item are placed in order.
- A splice delays its first packets by the time between its streams' first
  timestamps: a few frames in practice, and at most half a second of stream
  time once its streams appear. A process that writes only program tables
  is held until the next splice.
- A resumed item continues after the stand-in on the output timeline, so
  the join point, which counts keyframes (ADR 0018), is unchanged.
- `npm run test:ffmpeg` decodes every capture with `expectCleanDecode`,
  which fails on any corrupt frame and on any backward timestamp FFmpeg
  reports at a splice.

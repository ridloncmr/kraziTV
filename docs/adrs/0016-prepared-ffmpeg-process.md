# 0016 A Prepared Item's FFmpeg Process Starts Ahead And Holds Its Output

## Status

Accepted on 2026-10-18. Settles the question
[spec 0006](../specs/features/001-mvp/specs/0006-signal-packager.md) left to
the compatibility spike: whether preparing the next playout item uses a second
FFmpeg process. Keeps [ADR 0008](0008-shared-active-channel-stream-workers.md)'s
rule of one committed pipeline and at most one prepared item per channel.

Amended on 2026-10-28: a prepared process that fails or stays silent before
its commit no longer fails the session there, and a committed one no longer
fails it either; the session airs a stand-in until the next commit. See
[ADR 0020](0020-failed-item-stand-in.md).

## Context

A signal session serves one channel's broadcast from successive FFmpeg
processes, one per playout item. Until now a preparation only validated the
next item; its FFmpeg process started at the commit, at the boundary. FFmpeg
needs about 1.7 seconds on the reference hardware to open the input, start
its encoders, and emit its first usable packets
([spike measurements](../knowledge_base/plex-signal-spike.md)), so every
boundary, between programs and into or out of filler, paused delivery for
that long. Plex tolerated the pause, but a viewer saw a freeze at every
transition, most visibly on filler and black-tail boundaries where the
picture is static.

Starting the next process early and forwarding it live would not help: every
process paces its reads at wall-clock speed from its media offset, so a
process started early runs ahead of the schedule by its lead minus its
startup time, and the item would end that much early.

## Decision

- **`prepare()` starts the item's FFmpeg process at once and holds its
  output.** The session attaches the process to a bounded held output
  instead of the broadcast and returns as soon as the process is started, so
  the worker's commit at the boundary switches to a process that is already
  producing packets. Readiness is observed while the output is held, never
  awaited by the worker: a commit made before the process is ready, as at a
  cut learned late, goes ahead and pays the startup once, as every commit
  did before.
- **`commit()` releases the held output after the previous process's
  finished packets, then forwards live.** The viewer receives the held span
  at the boundary and the item from there in real time, so the broadcast
  still advances at wall-clock speed; delivery runs ahead of the clock by at
  most the lead minus the startup time, which the player buffers. Continuity
  counters are rewritten where packets reach the output, whether held or
  live, so the splice is seamless to a decoder.
- **`discard()` stops the process and drops what it held.** A failed stop
  leaves the preparation outstanding so a retry finishes it.
- **The worker's prepare lead is how far ahead the process starts.** The
  server uses 3 seconds, the measured startup with margin; the held span is
  the difference. A short item that finishes before its boundary is released
  whole at the commit.
- **Preparation stays bounded and revocable.** A prepared process that
  fails, or stays silent past the readiness timeout counted from its start,
  is stopped while the airing item plays on, and its commit then fails the
  session, as a process that could not start did; once committed, the same
  silence fails the session directly. Held output past its limit fails the
  session, so a lead far longer than intended can never grow memory without
  end.
- **A cut learned inside the lead, and a stale-selection recovery, still pay
  the startup once.** Only a boundary known at least a lead ahead is
  seamless; a reservation saved to start now is such a cut.

## Consequences

- Transitions between programs, filler, and black tails no longer pause the
  signal when the boundary is known a lead ahead.
- Two FFmpeg processes run side by side for up to the lead at every
  boundary, so peak CPU rises briefly; memory for held output is bounded.
- Logs report `signal_prepared_item_ready` when the next process is ready
  and `signal_transition_committed` at the commit; the former
  `signal_committed_item_ready` is gone.
- `npm run test:ffmpeg` is the evidence that real processes splice cleanly;
  the glossary's **Signal preparation** now names the held process.

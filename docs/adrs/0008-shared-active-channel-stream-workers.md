# 0008 Shared Active Channel Stream Workers

## Status

Accepted

## Context

kraziTV channels should behave like broadcasts, not viewer sessions. The earlier MVP streaming shape allowed each viewer request to own its own FFmpeg process or process sequence. That can prove basic playback, but it does not match the product model where a channel exists independently of its viewers.

Per-viewer encoders also make future channel behavior harder. Commercial breaks, station IDs, manual interruptions, and operational monitoring should belong to the channel signal, not to many independent viewer-specific streams.

## Decision

kraziTV will use at most one lazily-created shared stream worker per channel while that channel is watched or retained during idle grace.

The worker owns one SignalPackager/FFmpeg broadcast pipeline and dynamically fans encoded MPEG-TS output out to all current channel subscribers. The first subscriber starts the worker. Later subscribers reuse the same worker. The worker stops after the last subscriber disconnects and an idle grace period expires.

Channel disable and deletion are operational shutdown signals. After the
configuration mutation commits, `apps/server` asks `ChannelStreamManager` to
stop that channel and awaits cleanup before returning success. The manager
cancels pending creation, rejects or closes racing subscriptions, closes current
subscriber streams, and stops the active or idle-grace worker without waiting
for idle grace. Re-enabling a channel allows a later subscription to create a
fresh worker. Ordinary programming changes do not force this shutdown and keep
the current broadcast under the schedule-regeneration policy.

An administrative stop is idempotent and retryable. If cleanup fails after the
configuration mutation commits, the mutation remains committed and `apps/server`
returns a retryable `503` that explicitly reports `persistenceCommitted: true`.
The manager retains a non-joinable per-channel lifecycle record and all unsettled
resource handles until a later stop attempt or server shutdown completes cleanup.
Repeated disable requests retry the stop even when the channel is already
disabled; repeated delete requests retry it even when configuration is already
absent. Re-enabling cannot commit until cleanup of the prior worker succeeds.

The first worker resolves current channel state again after asynchronous worker
preparation and immediately before creating its SignalPackager/FFmpeg process.
It starts from that fresh wall-clock offset and retains the selected item's
scheduled end as an absolute transition deadline. Real-time FFmpeg input pacing
does not replace this startup synchronization step.

SignalPackager returns a stoppable session immediately and exposes asynchronous
readiness separately. The worker connects session output to its bounded startup
and fan-out buffer before awaiting readiness. Process spawn or an arbitrary
first stdout byte is insufficient; readiness requires output satisfying the
MPEG-TS initialization strategy verified by the compatibility spike.

The manager keeps a starting worker in its pending-creation state. Concurrent
subscriptions share that pending creation, but the worker is not published to
the active registry and no subscription succeeds until usable output is
buffered. Publication is a serialized per-channel lifecycle transition that
loses to cancellation, administrative stop, manager shutdown, or worker failure.
Startup timeout and the current item's absolute end bound the wait, and every
failed or cancelled startup settles its session and child processes.

The worker does not decide programming. It receives selected current and future
playout items from kraziBrain-owned domain logic. Future selections are
non-authoritative prefetch: each carries the materialized `scheduleRevision`.
SignalPackager may prepare packaging resources for those selections, but
preparation remains revocable and cannot change broadcast output. An active
channel has one committed encoder pipeline and at most one prepared-next item;
preparation has bounded memory and output and cannot spawn an unbounded queue of
future FFmpeg processes. The compatibility spike determines whether the one
prepared item uses a second process.

At or after the scheduled boundary, the worker passes the candidate and a
synchronous commit callback to an injected `TransitionCoordinator`.
`ChannelWorker` has no SQLite or Kysely dependency. The production coordinator
uses the same SQLite immediate-transaction boundary as schedule mutation,
revalidates the revision and entry, and invokes the callback before releasing
the boundary. The spike may inject an in-memory fake. That callback is the
transition linearization point. A regeneration that commits
first invalidates the preparation; a transition that commits first makes the
entry current and causes later regeneration to preserve it through `endsAt`.
The item already transmitting is not interrupted solely because the revision
changed.

SignalPackager remains responsible for encoding mechanics, FFmpeg process
construction, transcoding, muxing, seeking, and stream continuity primitives.

Per-viewer FFmpeg encoders are not the intended kraziTV streaming architecture.

This decision extends ADR 0005 by placing `ChannelStreamManager`, `ChannelWorker`, subscriber fan-out, and late-join stream initialization in `packages/signal` alongside SignalPackager.

The Plex compatibility spike will exercise production-intent implementations of
those `packages/signal` primitives. It may inject hard-coded channel and playout
data through narrow interfaces, but it must not build a parallel throwaway
worker, broadcaster, session, or FFmpeg lifecycle. Only the Plex/HDHomeRun
harness and its fixed metadata and media paths are disposable.

## Consequences

- Multiple viewers on one channel share encoding work.
- Viewers receive the same physical channel signal.
- Subscriber fan-out and buffering become explicit runtime concerns.
- Slow clients must be isolated so they cannot stall the shared broadcast.
- Late joining requires a verified MPEG-TS initialization strategy. A small rolling buffer is one candidate, not a decision made before the compatibility spike.
- The broadcast pipeline must advance at wall-clock speed independently of subscriber backpressure. The compatibility spike determines the verified FFmpeg pacing arguments.
- The compatibility spike must measure first usable output against the
  wall-clock schedule. The MVP permits at most 2,000 milliseconds of absolute
  initial tune drift, and startup delay must not move the next scheduled
  transition.
- Worker lifecycle becomes part of server shutdown behavior.
- Worker lifecycle also responds to committed channel disable/delete mutations;
  administrative stops bypass idle grace and terminate current subscriber
  streams.
- Cleanup failure does not roll back a committed disable/delete or masquerade as
  success. It produces a retryable partial-success error and retains the runtime
  handles needed for idempotent cleanup.
- Worker creation must be guarded so concurrent tune requests cannot create duplicate workers for one channel.
- Worker publication is readiness-gated: pending creations may be shared by
  waiters but are not joinable active workers.
- Startup failure is reported before a streaming response succeeds, and a
  cancelled or timed-out startup cannot leave an encoder process behind.
- Worker lifecycle transitions must be serialized so a tune request cannot attach to a stopping worker or race shutdown into creating an overlapping replacement.
- Manager shutdown is terminal: it rejects new tune requests, cannot create replacement workers, and must settle active workers and pending creations without leaving encoder processes behind.
- Failed workers may terminate current subscribers in the MVP; the next tune request can create a new worker.
- Every subscription revalidates inside its serialized per-channel transition
  that the channel exists and is enabled before attaching, including when a
  worker is already registered.
- A worker's future-item queue is a prefetch cache, not an independent
  programming authority; schedule revision changes invalidate it before the
  next transition.
- SignalPackager preparation is revocable. Only the worker's synchronous commit
  at the scheduled boundary makes a prepared item authoritative for output.
- ChannelWorker receives transition coordination as an injected abstraction;
  persistence adapters, not signal runtime code, own SQLite/Kysely mechanics.
- Schedule regeneration and following-item transition commitment serialize at
  the SQLite write-authority boundary, closing the check-then-transition race.
- The number of encoders scales with active channels rather than viewers.
- The architecture better supports commercials, station IDs, shared interruptions, and channel monitoring later.
- The compatibility spike becomes the first integration consumer of the durable
  streaming runtime rather than a prototype that must be rewritten after it
  succeeds.

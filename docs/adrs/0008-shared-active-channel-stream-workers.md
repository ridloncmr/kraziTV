# 0008 Shared Active Channel Stream Workers

## Status

Accepted

## Context

kraziTV channels should behave like broadcasts, not viewer sessions. The earlier MVP streaming shape allowed each viewer request to own its own FFmpeg process or process sequence. That can prove basic playback, but it does not match the product model where a channel exists independently of its viewers.

Per-viewer encoders also make future channel behavior harder. Commercial breaks, station IDs, manual interruptions, and operational monitoring should belong to the channel signal, not to many independent viewer-specific streams.

## Decision

kraziTV will use at most one lazily-created shared stream worker per channel while that channel is watched or retained during idle grace.

The worker owns one SignalPackager/FFmpeg broadcast pipeline and dynamically fans encoded MPEG-TS output out to all current channel subscribers. The first subscriber starts the worker. Later subscribers reuse the same worker. The worker stops after the last subscriber disconnects and an idle grace period expires.

The worker does not decide programming. It receives selected current and future playout items from kraziBrain-owned domain logic. SignalPackager remains responsible for encoding mechanics, FFmpeg process construction, transcoding, muxing, seeking, and stream continuity primitives.

Per-viewer FFmpeg encoders are not the intended kraziTV streaming architecture.

This decision extends ADR 0005 by placing `ChannelStreamManager`, `ChannelWorker`, subscriber fan-out, and late-join stream initialization in `packages/signal` alongside SignalPackager.

## Consequences

- Multiple viewers on one channel share encoding work.
- Viewers receive the same physical channel signal.
- Subscriber fan-out and buffering become explicit runtime concerns.
- Slow clients must be isolated so they cannot stall the shared broadcast.
- Late joining requires a verified MPEG-TS initialization strategy. A small rolling buffer is one candidate, not a decision made before the compatibility spike.
- The broadcast pipeline must advance at wall-clock speed independently of subscriber backpressure. The compatibility spike determines the verified FFmpeg pacing arguments.
- Worker lifecycle becomes part of server shutdown behavior.
- Worker creation must be guarded so concurrent tune requests cannot create duplicate workers for one channel.
- Worker lifecycle transitions must be serialized so a tune request cannot attach to a stopping worker or race shutdown into creating an overlapping replacement.
- Manager shutdown is terminal: it rejects new tune requests, cannot create replacement workers, and must settle active workers and pending creations without leaving encoder processes behind.
- Failed workers may terminate current subscribers in the MVP; the next tune request can create a new worker.
- The number of encoders scales with active channels rather than viewers.
- The architecture better supports commercials, station IDs, shared interruptions, and channel monitoring later.

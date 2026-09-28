# Shared Channel Streaming MVP

Status: Draft

This spec defines the MVP streaming behavior: one shared active-channel broadcast worker converts selected playout media and offsets into MPEG-TS output using SignalPackager and FFmpeg without making programming decisions.

## Problem

kraziTV needs to serve a continuous-looking Live TV stream once kraziBrain has decided what should be playing. The media packaging layer must turn local files into provider-consumable stream output, but it must not decide which program belongs on a channel or why it was selected.

kraziTV channels are broadcasts, not viewer sessions. The MVP should prove the simplest useful streaming path: lazily start one shared broadcast worker for an actively watched channel, join the current program at a calculated offset, continue across at least one program boundary, fan the MPEG-TS output out to multiple viewers, and produce output suitable for Plex to consume later.

## Goals

- Accept provider-neutral selected playout items from a channel worker.
- Start FFmpeg for a selected local media file.
- Seek to the requested offset when joining a program in progress.
- Continue a channel broadcast when the current playout item ends and the next scheduled item begins.
- Pace the broadcast against wall-clock time so local files do not play faster than their scheduled duration.
- Produce MPEG-TS output for shared channel fan-out over HTTP.
- Maintain at most one live packaging worker per channel, including during idle grace or shutdown.
- Allow multiple viewers to subscribe to the same active channel signal.
- Stop idle channel workers after a short grace period once the final subscriber disconnects.
- Keep FFmpeg command construction out of kraziBrain.
- Keep programming and schedule decisions out of SignalPackager.
- Report packaging failures clearly enough for API logs and debugging.
- Provide a stream contract future provider adapters can point at.

## Non-Goals

- Do not choose what media should play.
- Do not generate schedules.
- Do not generate playout timelines.
- Do not expose Plex XMLTV or M3U endpoints.
- Do not implement commercials, bumpers, station IDs, or filler insertion.
- Do not implement advanced transcoding profiles.
- Do not implement adaptive bitrate streaming, HLS, DASH, DVR, pause, rewind, or recording features.
- Do not implement distributed workers, cluster coordination, automatic worker failover, or GPU scheduling.
- Do not guarantee frame-perfect joins in the MVP.

## User-Facing Behavior

When a channel has a current playout item, a stream client can request that channel's stream URL and receive MPEG-TS output from the channel's shared active broadcast. The first subscriber lazily starts a `ChannelWorker`. Later subscribers reuse the same worker and receive the same physical channel signal.

Example flow:

```text
1. A viewer requests a channel stream URL.
2. ChannelStreamManager subscribes the viewer to the channel.
3. If no worker exists, kraziBrain-owned channel state resolves the current playout item.
4. Current item points to /mnt/media/TV/Show A/S01E02.mkv.
5. Current internal offset is 555000 milliseconds.
6. ChannelWorker starts one SignalPackager/FFmpeg session for the channel.
7. SignalPackager converts that offset to FFmpeg's required decimal-second argument and starts FFmpeg.
8. The viewer receives MPEG-TS bytes from the shared broadcast.
9. When Show A ends, the broadcast transitions to the next playout item without requiring clients to retune.
```

If media cannot be opened or FFmpeg fails before response bytes begin, the initial stream request should fail with a clear error and log context. If the shared worker fails after streaming begins, the affected subscriber streams terminate and the failure is logged. Future filler behavior can replace failures later.

## Technical Behavior

### Channel Stream Manager

`ChannelStreamManager` manages active channel broadcasts.

Conceptual interface:

```ts
interface ChannelStreamManager {
  subscribe(channelId: ChannelId): Promise<ChannelSubscription>;
  shutdown(): Promise<void>;
}

interface ChannelSubscription {
  stream: Readable;
  close(): void;
}
```

`ChannelSubscription.close()` is idempotent. It unregisters that subscriber and decrements the worker's subscriber count at most once, even if more than one HTTP cancellation or close path calls it.

Responsibilities:

- Track active `ChannelWorker` instances.
- Create a worker when the first subscriber tunes to a channel.
- Reuse an existing worker for later subscribers.
- Track subscriber counts.
- Stop idle workers after a configurable grace period.
- Prevent duplicate workers from being created concurrently for the same channel.
- Serialize subscription, idle timeout, worker failure, and worker-shutdown transitions per channel.
- Cancel pending idle shutdown and reuse the worker when a subscriber returns during idle grace.
- Never attach a subscriber to a worker after shutdown has begun.
- Reject new subscriptions after manager shutdown begins.
- Stop all active workers during server shutdown.

The manager does not decide what media should play.

Concurrent subscriptions for the same channel must await the same worker creation. All subscribe, final-unsubscribe, idle-timeout, worker-failure, and worker-shutdown state changes must be serialized per channel. A subscription arriving during idle grace cancels the pending shutdown and reuses the worker. If worker-local shutdown has begun, the subscription waits for the old worker to close and leave the registry, then participates in the single shared creation of its replacement. It must never attach to a stopping worker or overlap the old pipeline with a replacement.

Manager shutdown is terminal and distinct from worker-local shutdown. Once manager shutdown begins, new subscriptions are rejected and no replacement workers may start. Pending worker creations must be cancelled when possible and awaited in all cases. If a pending creation starts a worker, SignalPackager session, or FFmpeg process before observing cancellation, it must stop those resources without publishing the worker. `shutdown()` resolves only after active workers, pending creations, SignalPackager sessions, subscriber streams, and child processes have settled.

### Channel Worker

A `ChannelWorker` represents the active physical broadcast signal for one channel.

Responsibilities:

- Own one active SignalPackager/FFmpeg process or process sequence for the channel.
- Consume selected playout items supplied by kraziBrain-owned channel state.
- Transition between scheduled playout items.
- Broadcast encoded MPEG-TS output to multiple subscribers.
- Maintain independent subscriber buffers.
- Maintain the late-join initialization state required by the compatibility-spike results.
- Request future selected playout items when its queue becomes low.
- Stop when the channel remains idle after the grace period.

The worker must not generate schedules, choose media, apply programming rules, decide what plays next, modify guide data, or become a second kraziBrain.

### SignalPackager Session Contract

SignalPackager represents an encoder/packaging session owned by a channel worker, not a per-viewer HTTP request.

Conceptual interface:

```ts
interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

interface SignalSession {
  output: Readable;
  append(item: SignalPlayoutItem): Promise<void>;
  stop(): Promise<void>;
}
```

Exact names may change during implementation. The durable contract is that SignalPackager owns encoding mechanics while the worker owns active broadcast lifetime and replenishment.

Minimum selected playout item fields:

```text
SignalPlayoutItem
channelId
playoutItemId
mediaItemId
mediaPath
mediaOffsetMs
playDurationMs
```

`mediaOffsetMs` is the absolute position in the source media where packaging starts. `playDurationMs` is the maximum wall-clock duration to emit from that position before transitioning to the next selected playout item.

For the initial current item, the worker maps channel state's calculated `offsetMs` to `mediaOffsetMs`. It calculates `playDurationMs` from the remaining scheduled airtime (`endsAt - evaluatedAt`), clamped to the media remaining after `mediaOffsetMs`. For a following item, the worker maps the playout item's `startOffsetMs` to `mediaOffsetMs` and its selected playout duration to `playDurationMs`. Both fields use safe integer milliseconds.

SignalPackager must not query channel rules, choose media, advance schedules, or modify playback history.

A narrow playout provider may be used by the worker:

```ts
interface PlayoutProvider {
  getCurrent(channelId: ChannelId, atMs: number): Promise<CurrentChannelState>;
  getFollowing(
    channelId: ChannelId,
    afterPlayoutItemId: string,
    count: number,
  ): Promise<PlayoutItem[]>;
}
```

`atMs` is a UTC Unix epoch timestamp in integer milliseconds, consistent with ADR 0007.

The exact shape can evolve. The rule is that the worker asks for selected playout; it never selects playout.

### Output Contract

SignalPackager produces a readable MPEG-TS stream for a channel worker. The channel worker fans that stream out to HTTP subscribers.

MVP output format:

```text
video/MP2T
```

The stream should be consumable by clients that expect MPEG-TS over HTTP.

### FFmpeg Behavior

SignalPackager owns FFmpeg process construction and lifecycle.

The MVP should support:

- Input file path
- Seek offset
- MPEG-TS output to stdout
- Process stderr capture for logs
- Process cleanup when the channel worker stops
- Non-zero exit handling
- Transitioning from the current item to at least the next item in one logical channel broadcast

The MVP transcodes every program into one compatibility profile. Stream copy is deferred so media transitions do not depend on source codec compatibility.

Initial compatibility profile:

```text
Video: H.264, yuv420p, 1920x1080, 30 fps
Audio: AAC, 48 kHz, stereo
Container: MPEG-TS
Content type: video/MP2T
```

Video preserves source aspect ratio and is scaled and padded to the target frame without cropping.

The command must be constructed from structured arguments, not shell string concatenation.

FFmpeg is spawned directly with `shell: false`. Process stderr retained for diagnostics uses a 64 KiB tail buffer so a noisy encoder cannot grow server memory without bound.

The broadcast must advance at approximately 1x wall-clock speed. FFmpeg file input must use verified real-time pacing, such as `-readrate 1`, `-re`, or an equivalent mechanism, so subscriber isolation does not allow the encoder to race ahead of the playout timeline. The compatibility spike must verify the exact arguments and acceptable drift across a real two-file boundary.

SignalPackager validates `mediaOffsetMs` as a non-negative safe integer and `playDurationMs` as a positive safe integer. It converts them to decimal-second strings only at FFmpeg argument construction; internal packaging contracts do not use floating-point seconds.

The compatibility spike determines whether independent FFmpeg processes can cross a file boundary reliably in Plex. The formal implementation must use the simplest verified strategy, whether sequential processes or a concat-oriented FFmpeg graph. Callers see one continuous channel broadcast either way.

If sequential FFmpeg processes are used, Plex compatibility must be verified with a real two-file boundary, not only by checking that the HTTP connection remains open. The compatibility spike should confirm that Plex continues playback across the boundary despite any MPEG-TS timestamp, PCR, or continuity-counter discontinuities caused by independent encoder runs.

### Shared Stream Fan-Out

FFmpeg produces one MPEG-TS stream into kraziTV for an active channel. kraziTV fans that stream out dynamically to viewers.

Preferred topology:

```text
FFmpeg stdout
  |
  v
Channel broadcaster
  |
  +-- Subscriber A buffer
  +-- Subscriber B buffer
  +-- Subscriber C buffer
```

Do not configure FFmpeg with one output per viewer. FFmpeg's output topology must not change when viewers connect or disconnect.

Each subscriber has independent buffering. If a subscriber exceeds its buffer limit, that subscriber is disconnected while the shared broadcast continues. A slow subscriber must never apply backpressure to FFmpeg or stall other subscribers.

Late joiners must be able to join an already-running MPEG-TS signal. The compatibility spike must determine the initialization strategy, including whether periodic PAT/PMT and keyframe behavior are sufficient or whether the worker needs a bounded rolling buffer from a recent safe point. Any buffer must have an explicit byte or duration limit. This is not DVR, pause, or rewind behavior.

### Stream Endpoint

The API should expose an endpoint equivalent to:

```text
GET /channels/:id/stream
```

Exact route names can change during implementation, but the capability should remain equivalent.

The stream endpoint should:

- Subscribe the HTTP client through `ChannelStreamManager`.
- Lazily start a `ChannelWorker` for the channel when needed.
- Reuse an existing `ChannelWorker` for later subscribers.
- Return MPEG-TS output from the shared broadcast.
- Close only that viewer's subscription when the client disconnects.

The provider-neutral endpoint is registered by `apps/server`; provider adapters link to it rather than owning a separate packaging route.

### Error Handling

Failure cases should include:

- Channel not found
- Channel disabled
- No current playout item
- Missing media path
- Invalid offset
- FFmpeg not found
- FFmpeg startup failure
- FFmpeg exits before producing usable output

Errors should be logged with channel ID, media item ID, media path when safe, offset, and FFmpeg exit information when available. Before response bytes begin, failures return a structured HTTP error. After streaming begins, failures are logged and the affected subscriber streams terminate; the MVP does not synthesize an error or filler stream.

If the shared worker dies, all current subscribers are affected. The MVP may log the worker failure, terminate connected subscriber streams, remove the failed worker from the registry, and allow the next tune request to create a new worker. Automatic restart and seamless recovery are deferred.

### Resource Management

- Each channel has at most one live shared channel worker, including during idle grace and shutdown.
- Each channel worker owns one active FFmpeg process or process sequence at a time.
- Multiple viewers on the same channel share the worker output.
- Channels without an active or idle-grace worker consume no encoding resources.
- Workers stop only after the final subscriber disconnects and the idle grace period expires.
- Client disconnect closes that subscriber without stopping the worker if other subscribers remain.
- FFmpeg processes must be terminated when their channel worker stops.
- Worker shutdown must wait for child-process closure and escalate termination after a bounded grace period; the MVP default is 5 seconds.
- While an idle-grace worker has no subscribers, it must continue draining and pacing the broadcast without accumulating unbounded output.
- Server shutdown must first reject new subscriptions, then cancel and await pending worker creation, stop active workers, terminate FFmpeg processes, close subscriber streams, and allow persistence cleanup.

The number of FFmpeg encoders should scale with actively watched channels, not viewers.

The FFmpeg executable defaults to `ffmpeg` on `PATH` and can be overridden with the `FFMPEG_PATH` environment variable.

## Data Model Impact

This slice does not require persistent domain data.

Optional operational logging may record stream attempts, failures, worker starts/stops, subscriber counts, or FFmpeg exit codes, but that is not required for MVP correctness.

Future packaging profiles may introduce persistent configuration, but the MVP should avoid profile tables until a concrete need exists.

## Architecture Boundaries

This slice affects:

- Schedule: not directly.
- Playout timeline: indirectly, by consuming selected current and following playout items.
- Channel state: indirectly, by using current item and offset.
- kraziBrain: not directly; it must not construct FFmpeg commands.
- Channel stream workers: directly.
- SignalPackager: directly.
- Provider adapters: indirectly, by giving them a stream URL target.

Important boundaries:

- ChannelStreamManager owns lazy worker creation, subscriber tracking, idle shutdown, and worker cleanup.
- ChannelWorker owns active broadcast lifetime, selected playout queue consumption, stream fan-out, late-join stream initialization, and subscriber isolation.
- SignalPackager accepts selected media and offset from the worker; it does not decide what should be playing.
- SignalPackager owns FFmpeg command construction.
- kraziBrain owns playout decisions and current offset calculation.
- Provider adapters expose stream URLs that target the provider-neutral endpoint; they do not construct FFmpeg commands.
- `apps/server` owns HTTP routing, dependency wiring, request lifecycle wiring, and server shutdown coordination.
- `packages/signal` owns channel stream workers, subscriber fan-out, late-join stream initialization, FFmpeg lifecycle, transcoding, muxing, stream continuity, seeking, packaging, and encoding-profile code.
- `packages/media` owns media discovery, filesystem inspection, ffprobe, and source metadata. It must not grow stream packaging responsibilities.

## Compatibility Spike Output

The Plex spike must record the verified FFmpeg arguments, real-time pacing and drift behavior, whether sequential encoders preserve playback across the two-file boundary, the verified late-join initialization strategy, subscriber buffering behavior, idle-grace behavior, and whether two viewers share one active encoder. Before this spec changes from `Draft` to `Accepted`, it must define measurable MVP defaults or pass thresholds for acceptable pacing drift, subscriber buffer limits, late-join startup behavior, and idle-grace duration. Those empirical values may refine the fixed profile without changing the provider-neutral packaging contract.

## Deferred Work

- Stream-copy optimization for compatible sources.
- Filler streams for failures after response bytes begin.
- DVR, pause, rewind, HLS, DASH, adaptive bitrate ladders, distributed workers, automatic failover, GPU scheduling, and recording.

## Acceptance Criteria

- A first stream request for an enabled channel with a current playout item starts one `ChannelWorker` and one FFmpeg pipeline for the channel.
- FFmpeg receives `mediaOffsetMs` and `playDurationMs` calculated outside SignalPackager.
- The shared broadcast advances at approximately 1x wall-clock speed and does not race ahead when subscribers can accept data faster than real time.
- The HTTP response uses MPEG-TS output.
- Every item is transcoded to the fixed MVP compatibility profile.
- A viewer connected to a channel stream remains connected when the current playout item ends and the next scheduled item begins.
- A second viewer tuning the same channel reuses the existing worker.
- A second FFmpeg pipeline is not started for a second viewer on the same channel.
- Both viewers receive the shared broadcast signal.
- A late viewer can join an already-running worker successfully during the compatibility spike.
- Disconnecting one viewer does not affect other subscribers.
- A subscriber returning during idle grace cancels pending shutdown and reuses the existing worker.
- A subscription racing with worker shutdown never attaches to the stopping worker and never creates an overlapping FFmpeg pipeline.
- After manager shutdown begins, new subscriptions are rejected and no replacement worker starts.
- Manager shutdown resolves only after active workers and pending creations have settled and no SignalPackager session or FFmpeg process remains.
- Closing the same channel subscription more than once removes it and decrements the subscriber count only once.
- After the final viewer disconnects, the worker stops after the idle grace period.
- No FFmpeg process remains for the channel after worker shutdown.
- Plex remains playing for both viewers across an actual two-file boundary during the compatibility spike.
- FFmpeg stderr and exit information are logged for failures.
- FFmpeg is terminated when the channel worker stops.
- Slow subscribers are isolated and cannot stall the shared broadcast.
- FFmpeg stderr capture is bounded, and worker/session shutdown waits for child termination with escalation after the configured grace period.
- Missing media, invalid offsets, disabled channels, and no-current-item states fail clearly.
- SignalPackager does not choose media, generate schedules, generate playout timelines, or mutate channel state.
- ChannelWorker does not choose media, generate schedules, generate playout timelines, or mutate guide data.
- kraziBrain does not construct FFmpeg commands.

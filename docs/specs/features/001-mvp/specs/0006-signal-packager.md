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
- Build the compatibility spike's worker, broadcaster, session, and process
  lifecycle as production-intent `packages/signal` code that the MVP retains.

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
- Do not build a separate throwaway streaming stack solely for the compatibility
  spike.

## User-Facing Behavior

When a channel has a current playout item, a stream client can request that channel's stream URL and receive MPEG-TS output from the channel's shared active broadcast. The first subscriber lazily starts a `ChannelWorker`. Later subscribers reuse the same worker and receive the same physical channel signal.

Example flow:

```text
1. A viewer requests a channel stream URL.
2. ChannelStreamManager subscribes the viewer to the channel.
3. If no worker exists, a preliminary channel-state lookup validates that the channel can start.
4. Current item points to /mnt/media/TV/Show A/S01E02.mkv.
5. After worker preparation, ChannelWorker resolves channel state again as the final step before process creation.
6. The fresh current offset is 555000 milliseconds.
7. ChannelWorker starts one SignalPackager/FFmpeg session for the channel.
8. SignalPackager converts that offset to FFmpeg's required decimal-second argument and starts FFmpeg.
9. ChannelWorker immediately connects session output to its bounded startup and
   fan-out buffer, then waits for SignalSession readiness.
10. After usable MPEG-TS is buffered, ChannelStreamManager publishes the worker
    and completes the subscription.
11. The viewer receives MPEG-TS bytes from the shared broadcast.
12. When Show A ends, the broadcast transitions to the next playout item without requiring clients to retune.
```

If media cannot be opened or FFmpeg fails before response bytes begin, the initial stream request should fail with a clear error and log context. If the shared worker fails after streaming begins, the affected subscriber streams terminate and the failure is logged. Future filler behavior can replace failures later.

## Technical Behavior

### Channel Stream Manager

`ChannelStreamManager` manages active channel broadcasts.

Conceptual interface:

```ts
interface ChannelStreamManager {
  subscribe(
    channelId: ChannelId,
    options?: { signal?: AbortSignal },
  ): Promise<ChannelSubscription>;
  stopChannel(
    channelId: ChannelId,
    reason: "disabled" | "deleted",
  ): Promise<void>;
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
- Track starting workers as private pending creations and publish only workers
  that have produced usable buffered output.
- Validate channel existence and enabled state inside every serialized
  subscription transition, including subscriptions to an existing worker.
- Serialize subscription, administrative stop, idle timeout, worker failure,
  and worker-shutdown transitions per channel.
- Cancel pending idle shutdown and reuse the worker when a subscriber returns during idle grace.
- Remove a cancelled startup waiter without cancelling the shared creation while
  other waiters remain; cancel creation if no waiter remains before publication.
- Never attach a subscriber to a worker after shutdown has begun.
- Reject new subscriptions after manager shutdown begins.
- Stop all active workers during server shutdown.

The manager does not decide what media should play.

Concurrent subscriptions for the same channel must await the same worker
creation. All subscribe, administrative-stop, final-unsubscribe, idle-timeout,
worker-failure, and worker-shutdown state changes must be serialized per
channel. A subscription arriving during idle grace cancels the pending shutdown
and reuses the worker. If worker-local shutdown has begun, the subscription
waits for the old worker to close and leave the registry, then participates in
the single shared creation of its replacement only if the channel still exists
and is enabled. It must never attach to a stopping worker or overlap the old
pipeline with a replacement.

A pending creation is not an active, joinable worker. Concurrent subscriptions
may share and await it, but the manager must not return a `ChannelSubscription`,
publish the worker in its active registry, or let an HTTP handler commit a
successful streaming response until worker readiness completes. Publication is
serialized with cancellation, administrative stop, shutdown, and worker failure
so a session that becomes ready while being stopped cannot escape into the
active registry.

`stopChannel()` is a per-channel operational stop, not terminal manager
shutdown. It cancels pending creation, prevents publication of a worker created
by a losing race, closes current subscriber streams, and stops the active or
idle-grace worker without waiting for idle grace. It resolves only after the
worker, SignalPackager session, subscribers, and child processes settle. A later
subscription may start a fresh worker only after channel authorization reports
that the channel is enabled again.

Manager shutdown is terminal and distinct from worker-local shutdown. Once manager shutdown begins, new subscriptions are rejected and no replacement workers may start. Pending worker creations must be cancelled when possible and awaited in all cases. If a pending creation starts a worker, SignalPackager session, or FFmpeg process before observing cancellation, it must stop those resources without publishing the worker. `shutdown()` resolves only after active workers, pending creations, SignalPackager sessions, subscriber streams, and child processes have settled.

### Channel Worker

A `ChannelWorker` represents the active physical broadcast signal for one channel.

Responsibilities:

- Own one active SignalPackager/FFmpeg process or process sequence for the channel.
- Consume selected playout items supplied by kraziBrain-owned channel state.
- Resolve current channel state again immediately before creating the first
  SignalPackager/FFmpeg process.
- Transition between scheduled playout items.
- Broadcast encoded MPEG-TS output to multiple subscribers.
- Expose readiness only after usable initialization and media output is retained
  for the first subscriber.
- Maintain independent subscriber buffers.
- Maintain the late-join initialization state required by the compatibility-spike results.
- Prefetch future selected playout candidates when its queue becomes low.
- Prepare future packaging resources without committing those candidates to the
  broadcast.
- Revalidate the persisted schedule revision and commit exactly one prepared
  item at every scheduled transition boundary.
- Stop when the channel remains idle after the grace period.

The worker must not generate schedules, choose media, apply programming rules, decide what plays next, modify guide data, or become a second kraziBrain.

### First-Worker Wall-Clock Synchronization

A current-state lookup performed when subscription or worker creation begins is
only a preliminary validation. Worker setup, dependency calls, and process
startup consume wall-clock time, so the worker must resolve current channel
state again after asynchronous preparation and as the final step immediately
before creating the first SignalPackager/FFmpeg process. No avoidable
asynchronous work may occur between that lookup and process creation.

The worker derives `mediaOffsetMs` and the remaining scheduled airtime from this
fresh state's `evaluatedAt`. It retains the current playout item's `endsAt` as an
absolute wall-clock transition deadline. Startup latency must not extend the
item past that deadline and shift later programming. If the item ends before
the process produces usable output, the worker discards that startup attempt
and resolves current state again instead of emitting the expired item.

For the MVP, the first active worker's absolute initial tune drift must be no
more than 2,000 milliseconds. The compatibility spike measures:

```text
scheduledMediaPositionMs =
  startOffsetMs + firstUsableOutputAtMs - startsAt

initialTuneDriftMs =
  actualMediaPositionAtFirstUsableOutputMs - scheduledMediaPositionMs
```

Negative drift means the emitted broadcast is behind the wall-clock schedule.
"First usable output" means the earliest captured MPEG-TS point for which the
test can identify the program and decode media after the required stream
initialization data; process creation and the first arbitrary stdout byte do not
count. The spike must use a test asset or capture analysis that can identify the
actual media position represented by that output.

Real-time pacing and startup synchronization are separate requirements.
`-readrate 1` or `-re` prevents normal file ingestion from racing ahead, but it
does not by itself prove that encoder startup latency was recovered. If late
state resolution cannot meet the 2,000 millisecond ceiling, the spike must
verify a bounded startup strategy such as `-readrate_initial_burst`,
`-readrate_catchup`, or an equivalent mechanism. Any such mechanism must be
tested end to end with emitted MPEG-TS and Plex; its input-rate semantics alone
are not sufficient evidence.

### Startup Readiness and Worker Publication

SignalPackager returns a `SignalSession` synchronously so the worker can attach
the broadcaster to `output` immediately and can stop a session whose startup is
still pending. The session exposes a `ready` promise. Process creation, a live
child process, or the first arbitrary stdout byte must not resolve it.

`ready` resolves only after the session has emitted the initialization and media
output required by the compatibility spike's verified MPEG-TS startup strategy.
The worker must attach its bounded startup/late-join buffer before awaiting this
promise. Worker readiness additionally requires that this usable output is
retained in that buffer and that the worker has not entered stopping or failed
state.

The manager tracks the worker privately as a pending creation during startup.
All concurrent subscriptions await the same pending creation, but none attaches
and no successful HTTP response begins until the worker is ready and is
published through the serialized per-channel lifecycle transition. Publication
must recheck cancellation, manager shutdown, worker failure, and channel
authorization. A losing startup is stopped and settled without ever becoming
joinable.

Startup waiting is bounded by both the current item's absolute `endsAt` and a
configurable worker-startup timeout. The compatibility spike sets the MVP timeout
from observed FFmpeg and Plex behavior. If the item expires first, the worker
stops that session and resolves fresh current state while time remains in the
overall startup timeout. If readiness rejects, the timeout expires, shared
creation cancellation wins, or the worker fails before publication, the
remaining waiting subscriptions fail without streaming response bytes and all
session and child-process resources must settle. A readiness rejection caused by
the worker stopping an expired attempt is handled by the bounded fresh-state
retry rather than reported as an independent packaging failure. `stop()` is
valid before readiness and must cause a pending `ready` promise to reject or
otherwise settle without leaking a child process.

### Schedule Revision and Prefetch

The materialized schedule remains authoritative while a worker is active. Every
current or following playout selection carries the monotonic `scheduleRevision`
under which it was derived. A worker may retain multiple future candidates for
I/O preparation, but neither selection nor preparation commits that programming
to the broadcast.

The worker may ask SignalPackager to prepare a future item before its scheduled
boundary. Preparation may allocate resources or prewarm an encoder, but it must
not alter session output, reserve that item as the next broadcast item, or make
it immune to schedule regeneration. An uncommitted preparation is revocable and
must be discardable when its selection becomes stale or the worker stops.

At or after the item's scheduled transition deadline, the worker enters the
schedule-transition coordination boundary. This boundary uses the same
connection-pinned SQLite `BEGIN IMMEDIATE` mechanism as schedule mutation. After
acquiring write authority, the worker obtains the boundary time, reads the
persisted revision, and confirms that the prepared schedule entry is the entry
covering that time (`startsAt <= boundaryTime < endsAt`). It discards all stale
preparations and asks the playout provider for fresh selected playout when either
check fails.

While it still owns that coordination boundary, the worker synchronously
commits the valid preparation to SignalPackager. Successful `commit()` return is
the transition's single linearization point: the preparation has been consumed,
the item is irrevocably accepted as the next transmitted item, and later
schedule regeneration treats it as the item already airing through its existing
`endsAt`. `commit()` must not perform asynchronous preparation or return before
acceptance. A failed `commit()` accepts no item and is a worker/session failure;
the expired previous item must not be extended to conceal it.

Schedule regeneration uses its transaction's time after acquiring the same
write authority. If regeneration acquires authority first, it commits its new
revision before the worker can validate, so the worker discards the stale
preparation. If the worker commits the transition first, later regeneration sees
the newly current entry and preserves it. An item must never be committed before
its scheduled boundary merely to avoid this coordination.

Revision revalidation is required even when no in-process schedule-change
notification was observed. A notification may invalidate the queue earlier,
but it is an optimization rather than the correctness mechanism. Consequently,
an active worker cannot maintain a long authoritative queue independent of the
persisted materialized schedule.

### SignalPackager Session Contract

SignalPackager represents an encoder/packaging session owned by a channel worker, not a per-viewer HTTP request.

Conceptual interface:

```ts
interface SignalPackager {
  start(initialItem: SignalPlayoutItem): SignalSession;
}

interface SignalSession {
  readonly ready: Promise<void>;
  output: Readable;
  prepare(item: SignalPlayoutItem): Promise<SignalPreparation>;
  stop(): Promise<void>;
}

interface SignalPreparation {
  commit(): void;
  discard(): Promise<void>;
}
```

Exact names may change during implementation. The durable contract is that SignalPackager owns encoding mechanics while the worker owns active broadcast lifetime and replenishment.

`ready` settles exactly once. It resolves only after usable output has been
emitted according to the verified startup strategy and rejects if packaging
fails or stops first. The worker attaches and drains `output` before awaiting
`ready`; callers must not wait for readiness before consuming the readable or
startup can deadlock behind stream backpressure.

`prepare()` resolves only when the item is ready for a bounded, synchronous
commit. It does not change the broadcast and does not promise that the item will
be used. `commit()` consumes the preparation exactly once and is the only
operation that makes it authoritative for output. `discard()` releases an
uncommitted preparation and is idempotent. Committing a preparation from another
session, or committing one that was already committed or discarded, fails
without changing output.

Minimum selected playout item fields:

```text
SignalPlayoutItem
channelId
scheduleEntryId
mediaItemId
mediaPath
mediaOffsetMs
playDurationMs
```

`mediaOffsetMs` is the absolute position in the source media where packaging starts. `playDurationMs` is the maximum wall-clock duration to emit from that position before transitioning to the next selected playout item.

For the initial current item, the worker maps the final pre-spawn channel
state's calculated `offsetMs` to `mediaOffsetMs`. It calculates `playDurationMs`
from the remaining scheduled airtime (`endsAt - evaluatedAt`), clamped to the
media remaining after `mediaOffsetMs`. The worker also enforces `endsAt` as an
absolute transition deadline, so process initialization time cannot extend the
program. For a following item, the worker maps the playout item's
`startOffsetMs` to `mediaOffsetMs` and its selected playout duration to
`playDurationMs`. Both fields use safe integer milliseconds.

SignalPackager must not query channel rules, choose media, advance schedules, or modify playback history.

A narrow playout provider may be used by the worker:

```ts
interface PlayoutProvider {
  getCurrent(channelId: ChannelId, atMs: number): Promise<CurrentChannelState>;
  getFollowing(
    channelId: ChannelId,
    afterScheduleEntryId: ScheduleEntryId,
    count: number,
  ): Promise<PlayoutSelection>;
  getScheduleRevision(channelId: ChannelId): Promise<number>;
}

interface PlayoutSelection {
  scheduleRevision: number;
  items: PlayoutItem[];
}
```

`atMs` is a UTC Unix epoch timestamp in integer milliseconds, consistent with ADR 0007.
`CurrentChannelState` and every item in `PlayoutSelection` carry the same
`scheduleRevision` as the materialized schedule snapshot used to derive them.
The revision read and entry reads must be consistent with one another.

For the MVP, `afterScheduleEntryId` is the continuation cursor because each
program playout item maps one-to-one to a persisted schedule entry. The provider
finds that entry within `channelId` and returns following items in channel
sequence order. A cursor that does not belong to the channel or no longer exists
under the selected schedule revision returns a stale/invalid-cursor result; the
worker must not guess a successor. A richer `PlayoutCursor` is deferred until a
single schedule entry can expand into multiple transmitted items.

The exact shape can evolve. The rule is that the worker asks for selected playout; it never selects playout.

### Output Contract

SignalPackager produces a readable MPEG-TS stream for a channel worker. The
channel worker begins draining it into the broadcaster immediately, including
while startup readiness is pending, and later fans that shared output out to
HTTP subscribers.

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

The broadcast must advance at approximately 1x wall-clock speed. FFmpeg file input must use verified real-time pacing, such as `-readrate 1`, `-re`, or an equivalent mechanism, so subscriber isolation does not allow the encoder to race ahead of the playout timeline. Pacing does not replace the first-worker synchronization rule above. The compatibility spike must verify the exact pacing and any startup catch-up arguments, initial tune drift, and drift across a real two-file boundary.

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
- Delay a successful streaming response until a new worker has produced and
  buffered usable output.
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
- Worker startup readiness timeout

Errors should be logged with channel ID, media item ID, media path when safe,
offset, readiness phase, and FFmpeg exit information when available. Because a
new worker is not published before readiness, startup failures return a
structured HTTP error without a partially successful streaming response. After
streaming begins, failures are logged and the affected subscriber streams
terminate; the MVP does not synthesize an error or filler stream.

If the shared worker dies, all current subscribers are affected. The MVP may log the worker failure, terminate connected subscriber streams, remove the failed worker from the registry, and allow the next tune request to create a new worker. Automatic restart and seamless recovery are deferred.

If an administrator disables or deletes a channel, connected streams terminate
when the manager performs the channel's operational stop. The stop reason and
channel ID are logged. Because response bytes have already begun, subscribers
observe stream closure rather than a replacement error payload or completion of
the current program.

### Resource Management

- Each channel has at most one live shared channel worker, including during idle grace and shutdown.
- Each channel worker owns one active FFmpeg process or process sequence at a time.
- Multiple viewers on the same channel share the worker output.
- Channels without an active or idle-grace worker consume no encoding resources.
- Under ordinary viewer-driven lifecycle, workers stop only after the final
  subscriber disconnects and the idle grace period expires.
- Channel disable/delete is an administrative exception: it bypasses idle grace,
  closes all subscribers, cancels pending creation, and stops the worker.
- Pending worker creation consumes encoding resources but is not joinable; it is
  tracked separately and shares one bounded readiness wait across concurrent
  subscriptions.
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

- ChannelStreamManager owns lazy worker creation, readiness-gated publication,
  subscriber tracking, idle shutdown, and worker cleanup.
- ChannelStreamManager owns per-channel operational stops requested after a
  channel is disabled or deleted; `apps/server` owns coordinating that request
  with the committed configuration mutation.
- ChannelWorker owns active broadcast lifetime, non-authoritative playout
  prefetch, schedule-transition coordination, schedule-revision revalidation,
  startup buffering, stream fan-out, late-join stream initialization, and
  subscriber isolation.
- SignalPackager prepares selected media and performs the worker's synchronous
  transition commit. It also reports when its output first satisfies the
  verified usable-output strategy; it does not decide what should be playing or
  when a worker becomes joinable.
- SignalPackager owns FFmpeg command construction.
- kraziBrain owns playout decisions and current offset calculation.
- Provider adapters expose stream URLs that target the provider-neutral endpoint; they do not construct FFmpeg commands.
- `apps/server` owns HTTP routing, dependency wiring, request lifecycle wiring, and server shutdown coordination.
- `packages/signal` owns channel stream workers, subscriber fan-out, late-join stream initialization, FFmpeg lifecycle, transcoding, muxing, stream continuity, seeking, packaging, and encoding-profile code.
- `packages/media` owns media discovery, filesystem inspection, ffprobe, and source metadata. It must not grow stream packaging responsibilities.

## Compatibility Spike Code Boundary

The compatibility spike is an early vertical integration environment, not a
throwaway implementation of the streaming runtime. The following code is built
under `packages/signal` with production module boundaries and retained for the
MVP:

- `ChannelStreamManager` creation deduplication and per-channel lifecycle
  serialization.
- `ChannelWorker` startup readiness, lifecycle, item transitions, idle grace,
  and shutdown.
- SignalPackager session and FFmpeg process lifecycle.
- Shared broadcaster fan-out and independently bounded subscriber buffers.
- Slow-subscriber eviction without upstream backpressure.
- Late-join initialization buffering selected by the spike.
- Real-time pacing, first-worker synchronization, and two-file continuity.

Those primitives consume narrow injected interfaces for channel authorization,
selected playout, clocks/timers, and process creation. During the spike, small
fakes may hard-code Channel 69, two media files, and following-item selection.
The real scheduler, database, catalog, and provider metadata are integrated
later without replacing the tested streaming primitives.

Only the spike harness is disposable: hard-coded media paths, fake playout
state, fixed Plex/HDHomeRun metadata, manual measurement hooks, and temporary
routes or launch scripts. A harness component may be refactored into the Plex
adapter, but disposable harness code must not own a second worker, broadcaster,
or SignalPackager implementation.

Before Plex testing, automated tests cover worker-creation deduplication,
readiness-gated publication, shared success or failure for concurrent startup
waiters, cancellation before readiness, two subscribers sharing one broadcaster,
independent backpressure, idempotent subscription close, late join against the
chosen bounded initialization strategy, idle-grace cancellation, administrative
and server shutdown, and multi-item session orchestration. Real FFmpeg and Plex
tests then verify the environment-dependent pacing, initialization, and
continuity behavior that fakes cannot prove.

## Compatibility Spike Output

The Plex spike must record the final pre-spawn state-evaluation time, process
creation time, first usable output time, represented media position, calculated
initial tune drift, verified FFmpeg arguments, real-time pacing and drift
behavior, and any startup catch-up behavior. It must also record whether
sequential encoders preserve playback across the two-file boundary, the
verified late-join initialization strategy, subscriber buffering behavior,
idle-grace behavior, and whether two viewers share one active encoder.

The spike fails if absolute initial tune drift exceeds 2,000 milliseconds. Before
this spec changes from `Draft` to `Accepted`, it must also define measurable MVP
defaults or pass thresholds for ongoing pacing drift, subscriber buffer limits,
late-join startup behavior, and idle-grace duration. Those empirical values may
refine the fixed profile without changing the provider-neutral packaging
contract.

## Deferred Work

- Stream-copy optimization for compatible sources.
- Filler streams for failures after response bytes begin.
- DVR, pause, rewind, HLS, DASH, adaptive bitrate ladders, distributed workers, automatic failover, GPU scheduling, and recording.

## Acceptance Criteria

- A first stream request for an enabled channel with a current playout item starts one `ChannelWorker` and one FFmpeg pipeline for the channel.
- The compatibility spike exercises the production-intent
  `ChannelStreamManager`, `ChannelWorker`, broadcaster, and SignalPackager
  session primitives from `packages/signal`; it does not duplicate them in the
  harness.
- Reusable lifecycle and fan-out behavior has automated coverage independent of
  Plex before the manual compatibility run.
- A starting `SignalSession` is immediately stoppable and exposes a `ready`
  promise that does not resolve for process spawn or an arbitrary first byte.
- The worker drains session output into a bounded startup buffer before awaiting
  readiness, preventing startup backpressure and retaining initialization output
  for the first subscriber.
- A starting worker remains a private pending creation. Concurrent subscriptions
  await that one creation, and no subscription or successful HTTP stream response
  is published until usable output is buffered.
- Shared startup failure, timeout, administrative cancellation, or
  pre-publication worker failure rejects every remaining waiter without response
  bytes and settles the session and child process.
- Cancelling one startup waiter does not fail other waiters. If every waiter
  cancels before publication, the pending worker and SignalSession are stopped
  instead of becoming an unwatched active broadcast.
- Publication is serialized with stop and shutdown so a worker cannot become
  joinable after cancellation has won.
- The first worker resolves current channel state after asynchronous preparation
  and immediately before process creation; it does not start from the
  preliminary subscription-time offset.
- Absolute initial tune drift at first usable output is at most 2,000
  milliseconds during the compatibility spike.
- First-worker startup latency never extends the current item beyond its
  absolute scheduled `endsAt`; an item that expires before usable output is
  discarded and resolved again.
- FFmpeg receives `mediaOffsetMs` and `playDurationMs` calculated outside SignalPackager.
- Following-item lookup uses the persisted `scheduleEntryId` as its stable MVP
  cursor and rejects a missing or cross-channel cursor.
- The shared broadcast advances at approximately 1x wall-clock speed and does not race ahead when subscribers can accept data faster than real time.
- The HTTP response uses MPEG-TS output.
- Every item is transcoded to the fixed MVP compatibility profile.
- A viewer connected to a channel stream remains connected when the current playout item ends and the next scheduled item begins.
- A schedule regeneration while a worker is active preserves the current item,
  invalidates future candidates selected under the old `scheduleRevision`, and
  transitions to the item selected from the new materialized schedule.
- Preparing a future item does not commit it to the broadcast, and a stale or
  unused preparation can be discarded without changing session output.
- At every following-item boundary, the worker acquires the same SQLite
  immediate-transaction coordination boundary used by schedule mutation,
  revalidates the revision and entry, and calls synchronous `commit()` before
  releasing the boundary.
- A regeneration/transition race has one deterministic winner: regeneration
  first invalidates the preparation, while transition commit first makes the
  item current and requires regeneration to preserve it through `endsAt`.
- Multi-connection integration coverage exercises both orderings of a
  regeneration/transition race and proves that stale prepared output is never
  committed.
- No following item is committed before its scheduled boundary, even when it
  has already been prepared.
- A second viewer tuning the same channel reuses the existing worker.
- A second FFmpeg pipeline is not started for a second viewer on the same channel.
- Both viewers receive the shared broadcast signal.
- A late viewer can join an already-running worker successfully during the compatibility spike.
- Disconnecting one viewer does not affect other subscribers.
- A subscriber returning during idle grace cancels pending shutdown and reuses the existing worker.
- A subscription racing with worker shutdown never attaches to the stopping worker and never creates an overlapping FFmpeg pipeline.
- Disabling or deleting a channel cancels pending worker creation, rejects new
  subscriptions, closes existing subscriber streams, and stops its worker
  without waiting for idle grace.
- A successful disable/delete response is not returned until the channel's
  SignalPackager session and child processes have settled.
- Re-enabling a channel permits a later subscription to create a fresh worker;
  it never reuses the administratively stopped worker.
- Ordinary programming changes do not stop the active worker or interrupt the
  current item.
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

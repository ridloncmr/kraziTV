# Spec 0006 Implementation Plan: Shared Channel Streaming

Status: In Development

Source: [`docs/specs/features/001-mvp/specs/0006-signal-packager.md`](../specs/features/001-mvp/specs/0006-signal-packager.md)

This plan breaks the SignalPackager MVP into production-intent slices. The
compatibility spike uses the same `packages/signal` worker, broadcaster,
session, and process-lifecycle code that the product keeps. Only fixed channel
data, fixed media paths, temporary tuner metadata, measurement hooks, and spike
launch wiring are disposable.

## Delivery Strategy

Work proceeds in three bands:

1. Build deterministic streaming primitives behind narrow injected interfaces.
   These tickets can begin before catalog, schedule, and playout persistence is
   implemented.
2. Exercise those primitives with real FFmpeg and Plex. This evidence gate
   chooses the exact readiness, pacing, late-join, boundary-continuity, buffer,
   startup-timeout, and idle-grace settings.
3. Integrate the verified runtime with the real playout snapshot,
   transition-coordination, HTTP, and administrative lifecycle adapters.

The spike is not a separate implementation phase that can create parallel
runtime code. A spike result that requires a different implementation changes
the retained `packages/signal` primitive and its automated tests.

## Architecture and Ownership

```text
apps/server
  |-- provider-neutral stream route and request lifecycle
  |-- channel authorization and playout persistence adapters
  |-- SQLite TransitionCoordinator adapter
  `-- server/admin shutdown coordination
          |
          v
packages/signal
  ChannelStreamManager
          |
          v
  ChannelWorker --> ChannelBroadcaster --> subscriber streams
          |
          v
  SignalPackager / SignalSession --> FFmpeg child process
```

- `ChannelStreamManager` owns one serialized lifecycle record per channel,
  pending-creation deduplication, readiness-gated publication, subscriptions,
  idle grace, administrative stop, and terminal shutdown.
- `ChannelWorker` owns the active broadcast, final pre-spawn state lookup,
  bounded future selection, preparation, and transition orchestration.
- `ChannelBroadcaster` owns immediate upstream draining, bounded initialization
  retention, independent subscriber buffers, and slow-subscriber isolation.
- `SignalPackager` owns structured FFmpeg arguments, process lifecycle,
  transcoding, MPEG-TS output, readiness detection, and prepared-item mechanics.
- `apps/server` owns persistence, SQLite/Kysely mechanics, HTTP semantics,
  dependency wiring, logging, and coordination with channel mutations.
- `packages/core` remains the owner of current/following playout selection and
  offset calculations. `packages/signal` must not select programming.

The public `@krazitv/signal` surface should remain smaller than its internal
module graph. Export domain-facing contracts and construction entry points;
keep FFmpeg argument builders, MPEG-TS inspection, lifecycle-state machinery,
and test utilities internal.

The source tree groups contracts and private implementations by capability
rather than under one catch-all `internal` directory:

```text
packages/signal/src
  channel-broadcast/    subscriber fan-out and buffering
  channel-worker/       active channel worker lifecycle
  ffmpeg/
    packaging/          arguments, packager, and session
    mpeg-ts/            MPEG-TS inspection
    process/            FFmpeg-specific process lifecycle
  playout/              selected playout projections and provider port
  process/              provider-neutral process port and Node adapter
  runtime/              clock, timer, and logging ports
  signal-packager/      provider-neutral packaging contracts
  testing/              reusable deterministic test doubles
```

## Dependency and Decision Gates

| Gate                                   | Required before                                  | Exit condition                                                                                                                                |
| -------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| G1: deterministic runtime contracts    | lifecycle implementation                         | Injected authorization, playout, transition, clock/timer, process, and logging seams exist without SQLite, Kysely, Fastify, or Plex types.    |
| G2: automated runtime confidence       | manual Plex run                                  | Complete (SIG-009). Fake-driven tests cover startup, fan-out, transitions, cancellation, idle grace, administrative stop retry, and shutdown. |
| G3: FFmpeg/Plex compatibility evidence | freezing runtime defaults or accepting spec 0006 | Complete (SIG-011). The Linux/Plex matrix passed the 2,000 ms tune-drift ceiling and selected the recorded runtime defaults.                  |
| G4: specs 0002-0005 persistence        | production playout integration                   | Catalog, channels, schedules, and current/following playout snapshots are implemented with their documented transaction guarantees.           |
| G5: production coordination            | full stream route acceptance                     | SQLite transition races pass in both orderings and stale output is never committed.                                                           |

Until G3 passes, pacing flags, readiness detection, late-join replay shape,
preparation topology, and numeric defaults are provisional configuration rather
than stable public API.

## Phase 1: Durable Runtime Primitives

### SIG-001: Establish signal contracts and deterministic test kit

**Goal**

Make the runtime boundaries explicit enough that all lifecycle behavior can be
tested without FFmpeg, SQLite, Fastify, or real time.

**Scope**

- Refine the existing `SignalPackager`, `SignalSession`,
  `SignalPreparation`, and `TransitionCoordinator` contracts.
- Add narrow contracts for channel authorization, current/following playout,
  clock/timers, worker creation, process spawning, and structured logging.
- Define typed failure categories needed by the stream route without assigning
  HTTP status codes inside `packages/signal`.
- Add reusable fake clock/timer, fake packager/session/preparation, fake process,
  and fake playout provider test utilities.
- Split internal modules from the package's public exports.

**Out of scope**

- FFmpeg arguments, stream fan-out, worker behavior, persistence adapters, and
  HTTP routes.

**Blocking dependencies**

- None. This is the first implementation ticket.

**Implementation notes**

- Preserve integer millisecond timestamps and durations throughout contracts.
- A current/following result is one atomic projection carrying its own
  `scheduleRevision`; the worker must never assemble it from separate reads.
- Avoid exposing database rows, Kysely transactions, Fastify request objects,
  or Plex structures.

**Verification**

- Contract tests prove preparation commit/discard ownership and idempotence.
- Type-level fixtures prove server adapters can implement the ports without
  importing signal internals.
- `npm test --workspace @krazitv/signal`
- `npm run typecheck`

**Docs impact**

- Update spec 0006 only if implementation reveals a durable contract change.

### SIG-002: Build the bounded channel broadcaster

**Goal**

Continuously drain one channel source and fan it out without allowing any
subscriber to control broadcast pace.

**Scope**

- Implement broadcaster attachment before readiness waiting.
- Add independent, byte-bounded subscriber streams.
- Evict only a subscriber that exceeds its limit.
- Make subscriber close idempotent.
- Retain a configurable, bounded startup/late-join window and expose whether it
  contains a joinable initialization point.
- Continue draining while there are no subscribers during idle grace.

**Out of scope**

- Deciding the final MPEG-TS safe-point algorithm; the spike selects it.
- Worker registry, idle timers, FFmpeg processes, or HTTP response handling.

**Blocking dependencies**

- SIG-001.

**Implementation notes**

- The broadcaster must never propagate subscriber backpressure to the source.
- All retained byte counts need explicit caps and observable eviction reasons.
- Keep MPEG-TS safe-point detection behind a strategy so spike findings do not
  leak into subscriber lifecycle code.

**Verification**

- Two fast subscribers receive the same ordered source bytes.
- Stalling one subscriber evicts it without pausing source consumption or the
  other subscriber.
- Joining and closing races do not double-decrement counts or leak streams.
- Source output remains bounded with zero subscribers.
- Buffer-limit tests use small deterministic limits rather than large payloads.

**Docs impact**

- None until the compatibility spike selects the late-join strategy and limit.

### SIG-003: Add the FFmpeg process lifecycle primitive

**Goal**

Own child-process startup, bounded diagnostics, cancellation, and verified
termination in one reusable internal module.

**Scope**

- Spawn an executable with an argument array and `shell: false`.
- Expose stdout immediately and capture only a 64 KiB stderr tail.
- Normalize spawn failure, non-zero exit, signal exit, premature exit, and
  forced-termination failures with safe diagnostic context.
- Make stop idempotent, wait for child closure, and escalate after a configurable
  grace period whose MVP provisional default is five seconds.
- Accept a caller-resolved FFmpeg executable path, defaulting to `ffmpeg`.

**Out of scope**

- FFmpeg command policy, readiness, playout selection, or viewer fan-out.

**Blocking dependencies**

- SIG-001.

**Implementation notes**

- Treat successful signal delivery and actual process closure as different
  events.
- Resolve the `FFMPEG_PATH` application setting at the server composition
  boundary. Pass only the resolved executable path into `packages/signal`; do
  not forward kraziTV configuration variables explicitly into the child
  environment.
- Receive a caller-owned successful-exit expectation so the process primitive
  can normalize a zero-code premature exit without owning readiness or playout
  timing policy.
- Keep raw stderr available as bounded internal diagnostics, but do not place it
  in structured errors or automatic logs before the owning session deliberately
  classifies or sanitizes it.
- Keep OS-specific descendant/process-group handling internal and cover the
  supported development platforms discovered during the spike.

**Verification**

- Fake-process tests cover normal exit, spawn error, noisy stderr truncation,
  repeated stop, graceful termination, escalation, and stop during startup.
- No test relies on wall-clock sleeps; drive deadlines with the fake clock.

**Docs impact**

- Record any platform-specific cleanup limitation in the child-process safety
  knowledge-base note.

### SIG-004: Implement a single-item FFmpeg SignalSession

**Goal**

Turn one validated `SignalPlayoutItem` into paced MPEG-TS output through the
retained SignalPackager contract.

**Scope**

- Validate safe-integer `mediaOffsetMs` and positive safe-integer
  `playDurationMs`.
- Convert milliseconds to decimal seconds only in the argument builder.
- Build the fixed H.264/AAC, 1080p, 30 fps, yuv420p, aspect-preserving
  scale-and-pad, MPEG-TS profile.
- Apply provisional real-time input pacing and duration bounds.
- Return `SignalSession` synchronously with `output`, `ready`, and `stop()`.
- Put readiness behind an MPEG-TS output-inspection strategy so process spawn or
  an arbitrary first byte cannot resolve it.

**Out of scope**

- Multi-item continuity, final catch-up arguments, final readiness algorithm,
  and Plex compatibility claims.

**Blocking dependencies**

- SIG-003.

**Implementation notes**

- The output must be consumable before callers await `ready`.
- `ready` settles exactly once and stopping before readiness settles it without
  leaking the process.
- Back the process lifecycle's successful-exit expectation with session state so
  a clean exit before the expected lifecycle point is reported as premature.
- Redact or deliberately classify media paths before placing them in logs.

**Verification**

- Argument snapshots cover offset, duration, profile, scale/pad, pacing, stdout,
  and `shell: false` spawn behavior.
- Invalid offsets/durations fail before process creation.
- Fake output proves readiness waits for the configured usable-output condition.
- Early process failure and stop-before-ready reject or otherwise settle
  readiness and close the child.

**Docs impact**

- Do not freeze provisional pacing/readiness flags in the spec before SIG-011.

### SIG-005: Start one ChannelWorker at the fresh wall-clock position

**Goal**

Create a stoppable worker that starts one selected item without shifting its
absolute scheduled end.

**Scope**

- Perform preliminary validation, asynchronous worker preparation, then a fresh
  `getCurrent()` as the final asynchronous action before `SignalPackager.start()`.
- Derive `mediaOffsetMs` and remaining `playDurationMs` from the fresh result.
- Attach the broadcaster before awaiting session readiness.
- Gate worker readiness on usable bytes being retained and on the worker still
  being startable.
- Bound startup by both the item `endsAt` and an overall startup timeout.
- If an item expires before readiness, stop it and retry from fresh state while
  the overall timeout remains.

**Out of scope**

- Multiple subscribers, following-item transitions, idle grace, and persistence
  implementations.

**Blocking dependencies**

- SIG-002 and SIG-004.

**Implementation notes**

- There must be no avoidable asynchronous call between the final state result
  and process creation.
- Keep the absolute transition deadline separate from FFmpeg's relative
  duration bound.

**Verification**

- The process receives the offset from the final lookup, not preliminary state.
- Advancing the fake clock during setup changes the selected offset.
- An expiring item is stopped and replaced without surfacing its deliberate
  readiness rejection as an independent packaging failure.
- Timeout, cancellation, no-current-item, unavailable-media, and stop-before-
  ready paths settle every owned resource.

**Docs impact**

- None unless the fresh-state port needs a durable shape change.

### SIG-006: Add readiness-gated manager subscription and creation deduplication

**Goal**

Make concurrent viewers share one privately starting worker and publish it only
after readiness succeeds.

**Scope**

- Define the public manager-facing `ChannelSubscription` contract with
  `stream` and idempotent `close()` behavior. Let the existing broadcast
  subscription satisfy that contract directly instead of adding a wrapper.
- Implement per-channel lifecycle serialization.
- Revalidate channel existence and enabled state inside every subscription
  transition, including reuse of an active worker.
- Represent pending creation separately from an active joinable worker.
- Deduplicate concurrent first subscriptions.
- Expose worker completion or failure through a manager-facing signal that
  settles on every terminal worker path.
- Treat `AbortSignal` as cancellation of the pending `subscribe()` operation.
  Remove its listener when that operation settles; after successful
  subscription creation, the caller owns lifetime through `close()`.
- Support per-waiter abort without cancelling other waiters; cancel creation
  when the final waiter leaves before publication. Keep that lifecycle record
  non-joinable until cancellation cleanup settles so a new subscriber cannot
  start an overlapping worker.
- Add the terminal manager gate required by the publication race: once shutdown
  begins, reject new work, cancel and await pending creations, and stop and await
  workers already published by this slice. SIG-007 completes resource
  accounting, cleanup-failure retention, and retry behavior.
- Serialize publication with waiter cancellation, channel authorization,
  worker completion or failure, and manager shutdown.

**Out of scope**

- Idle grace, administrative stops and their retries, cleanup-failed record
  recovery, real HTTP, and SQLite adapters.

**Blocking dependencies**

- SIG-005.

**Implementation notes**

- A pending worker must not be discoverable through the active registry.
- Do not hold the per-channel transition open while worker readiness is pending.
  Register the shared pending creation inside the transition, await readiness
  outside it, then re-enter the transition for publication.
- Every caller must be authorized before it joins an active worker or pending
  creation. Recheck authorization once inside the serialized publication
  transition before attaching the surviving pending waiters.
- Treat an authorization result for a different channel ID as an invalid
  adapter result; it must never authorize the requested channel.
- The worker completion signal must let the manager observe termination even
  when no subscriber exists. Do not infer worker health solely from subscriber
  close events.
- Once a subscription is synchronously created in the serialized transition,
  it has won against later abort delivery. The caller must close the returned
  subscription normally.
- If a ready worker cannot create a subscription at publication time, treat it
  as a pre-publication worker failure: stop and await it, publish nothing, and
  reject the remaining waiters. A later tune may create a fresh worker.
- A losing creation must be stopped and awaited even if it became ready at the
  same instant that cancellation won.

**Verification**

- Many concurrent subscriptions cause one worker/session creation.
- No subscription returns before readiness and retained startup output.
- Shared startup failure rejects every remaining waiter without publishing.
- Cancelling one waiter preserves other waiters; cancelling all stops creation.
- A subscriber arriving while all-waiter cancellation cleanup is still running
  waits for cleanup and never overlaps the losing worker with a replacement.
- Worker termination between readiness and publication rejects the waiters and
  leaves no active worker.
- Shutdown or authorization loss wins a publication race and leaves no worker.
- Shutdown rejects later subscriptions and settles pending and active workers
  created by this slice.

**Docs impact**

- None.

### SIG-007: Complete active, idle, administrative, and terminal lifecycles

**Goal**

Make all manager/worker cleanup paths serialized, idempotent, and resource
complete.

**Scope**

- Connect the already-idempotent `ChannelSubscription.close()` behavior to
  manager-level subscriber accounting.
- Start idle grace after the final close and cancel it when a viewer returns.
- Prevent attachment to a stopping worker or overlap with a replacement.
- Implement `stopChannel(channelId, reason)` as an immediate operational stop.
- Retain cleanup-failed records and remaining handles for an idempotent retry.
- Complete terminal manager shutdown with exhaustive settlement of pending
  creation, workers, sessions, preparations, subscribers, and child processes,
  including cleanup-failure retention and retry-safe ownership.

**Out of scope**

- Database mutations, HTTP status mapping, and automatic worker restart.

**Blocking dependencies**

- SIG-006.

**Implementation notes**

- Removing a worker from an active registry is not proof of successful cleanup.
- A cleanup-failed record remains non-joinable and blocks new creation.
- Use the injected clock/timer for all idle and shutdown race tests.

**Verification**

- Return during idle grace reuses the same worker and cancels shutdown.
- Subscribe-versus-shutdown never attaches to a stopping worker or overlaps
  pipelines.
- Administrative stop bypasses idle grace and closes all subscribers.
- Failed stop retains only unsettled handles; retry completes them exactly once.
- Manager shutdown is terminal and leaves no pending worker or process.

**Docs impact**

- None.

### SIG-008: Add bounded following-item preparation and atomic transition use

**Goal**

Cross a scheduled item boundary without allowing the worker or packager to
become a programming authority.

**Scope**

- Prefetch a bounded amount of following-selection metadata by stable
  `scheduleEntryId` cursor.
- Allow exactly one outstanding `SignalPreparation`.
- Keep preparation revocable and output-neutral until synchronous `commit()`.
- At or after the absolute boundary, submit the candidate and commit callback to
  the injected `TransitionCoordinator`.
- On `stale`, discard and resolve fresh selected playout; on commit failure,
  fail the worker rather than extending the expired item.
- Support repeated transitions without accumulating processes or buffers.

**Out of scope**

- SQLite transaction mechanics and choosing the final sequential-process versus
  concat-oriented implementation.

**Blocking dependencies**

- SIG-005. Manager behavior from SIG-006/SIG-007 may be developed in parallel,
  but must be integrated for SIG-009.

**Implementation notes**

- Selection is a cache; only the transition coordinator's synchronous callback
  is the acceptance linearization point.
- Never commit before the scheduled boundary.
- A schedule-change notification may discard early but is never the correctness
  mechanism.

**Verification**

- Fresh candidate commits exactly once at/after its boundary.
- Stale revision or entry never invokes commit and releases preparation.
- Missing/cross-channel cursors are treated as stale selection, not guessed.
- Stop and failure discard unused preparations.
- Tests prove the one-prepared-next bound and no early commit.

**Docs impact**

- None until the spike chooses the process topology.

### SIG-009: Complete the pre-spike automated runtime suite

**Goal**

Demonstrate reusable lifecycle and fan-out correctness before using Plex as a
manual debugger.

**Scope**

- Add package-level integration scenarios using fake playout, a fake signal
  packager, and in-memory transition coordination. The FFmpeg session cannot
  cross a boundary until SIG-010, so process-handle cleanup is covered by a
  smaller tier that composes the real FFmpeg packager over fake processes.
- Exercise the real manager, worker, broadcaster, and transition loop together.
- Add leak assertions for timers, subscribers, sessions, preparations, and
  process handles after every failure scenario.

**Out of scope**

- Claims about FFmpeg timing, MPEG-TS decoder behavior, or Plex compatibility.

**Blocking dependencies**

- SIG-002 through SIG-008.

**Implementation notes**

- Prefer scenario helpers over duplicating elaborate race setup in each test.
- Keep random concurrency out of the suite; explicitly control each interleave.
- Bound every `TransitionLoop` await (`getFollowing`, `prepare`,
  `commitPreparedTransition`, `getCurrent`, `discard`) by a transition
  deadline, such as the boundary plus the recovery timeout, and fail the
  worker when it expires.

**Verification**

- Cover all automated behaviors listed in spec 0006's compatibility-spike code
  boundary and acceptance criteria.
- Run each lifecycle race repeatedly where practical without real sleeps.
- `npm test --workspace @krazitv/signal`
- `npm run typecheck`
- `npm run build`

**Docs impact**

- Mark G2 complete in this plan when the suite is green.

## Phase 2: FFmpeg and Plex Evidence Gate

### SIG-010: Build the retained real-FFmpeg baseline and disposable spike harness

**Goal**

Run the production-intent signal runtime against controlled media and expose it
through the smallest hard-coded Plex/HDHomeRun harness.

**Scope**

- Create or document two deterministic, visually/time identifiable test assets.
- Add real-FFmpeg smoke coverage for seek, fixed profile, pacing, usable-output
  detection, bounded stderr, cancellation, and one real boundary.
- Implement the simplest FFmpeg `SignalSession.prepare()`/`commit()` needed to
  cross that boundary. SIG-008 delivers worker orchestration only; until this
  lands, a real FFmpeg worker fails at its first transition.
- Provide fixed authorization, playout, and in-memory transition fakes for one
  channel and two files.
- Add disposable tuner metadata, temporary routes/launch wiring, and measurement
  capture without duplicating signal-runtime primitives.
- Fail fast with actionable prerequisites when FFmpeg or the test assets are
  absent.

**Out of scope**

- General Plex adapter behavior, production database wiring, and permanent
  hard-coded paths.

**Blocking dependencies**

- SIG-009.
- Coordinate the disposable tuner surface with the spec 0007 compatibility
  spike so there is only one harness.

**Implementation notes**

- Real-FFmpeg tests may be explicitly classified as environment/integration
  tests rather than silently skipped in the spike workflow.
- Record tool versions and test-asset identities with measurements.
- Prefer a sequential-process session: `prepare()` validates the supplied
  packaging inputs and resolves promptly without taking over ffprobe or source
  inspection from `packages/media`; `commit()` synchronously detaches the old
  encoder, spawns the next one, and stops the old one in the background,
  feeding its stop failures into session `completion`. A second process
  prewarmed with real-time
  pacing at the lead time either bursts or buffers about the lead time of
  output and finishes early, so it fits the worker's timing poorly.
- Keep `session.output` a session-owned stream fed with `{ end: false }`, and
  splice encoders only on 188-byte MPEG-TS packet boundaries so a killed
  encoder's partial packet cannot misalign viewers or join-point detection.
- Keep PMT and PIDs stable across items; `-map 0:a:0?` drops the audio PID for
  silent media, so synthesize silence instead.
- Individual item exits are internal to the session: `completion` settles only
  on stop or fatal failure, per the `SignalSession` contract.
- Honor the `SignalSession.stop()` contract: stop ends an in-flight
  `prepare()` or `discard()` before it settles, including any packaging-owned
  validation work. The worker stops the session concurrently with halting its
  transition loop and relies on this for both ordinary stops and transition
  deadline failures.
- The worker's transition deadline ends at `commit()`. Give the session its own
  per-item readiness timeout after a commit that rejects `completion` as fatal,
  so a next encoder that never produces output cannot leave a published channel
  idle.
- Detach the old encoder's stdout before signalling it, because FFmpeg flushes
  its muxer on SIGTERM and would otherwise append old-item bytes after the new
  item.
- Decide whether each splice sets the MPEG-TS discontinuity indicator or relies
  on client resync for continuity-counter and PCR/PTS jumps, and whether a
  commit that lands after its boundary seeks forward by its lateness.
- Decide whether the harness reuses `InMemoryTransitionCoordinator` through a
  `./testing` package export or supplies its own fake; `src/testing` is not
  exported today.

**Verification**

- The harness imports the actual public constructors from `@krazitv/signal`.
- Repository search finds no second worker, broadcaster, or packager
  implementation in the harness.
- Captured MPEG-TS can be decoded and its represented media position identified.

**Docs impact**

- Add repeatable spike setup and invocation instructions to the knowledge base.

### SIG-011: Run the compatibility matrix and choose empirical defaults

**Status**

Complete on 2026-09-29. The retained results and selected defaults are recorded
in the source specs and `docs/knowledge_base/plex-signal-spike.md`.

**Goal**

Produce the evidence required to make spec 0006 acceptably precise.

**Scope**

- Measure final state-evaluation, process creation, first usable output,
  represented media position, and absolute initial tune drift.
- Verify approximately 1x pacing and measure ongoing drift.
- Test normal pacing first, then bounded initial burst/catch-up only if needed.
- Test two Plex viewers sharing one encoder, a late join, one slow subscriber,
  final-subscriber idle grace, shutdown, and a real two-file boundary.
- Compare the simplest viable preparation/continuity and late-join strategies.
- Choose measurable thresholds/defaults for pacing drift, subscriber buffer,
  startup timeout, late-join behavior, and idle-grace duration.
- Measure how long Plex tolerates a live connection without MPEG-TS output, then
  either confirm `startupTimeoutMs` as the transition deadline window or split
  out a separate setting.
- Measure the output gap at each item boundary, the tail truncated by late
  commits, and commit latency, then set `prepareLeadMs` and any boundary gap
  bound from the results.

**Out of scope**

- Broad codec/profile optimization, HLS, stream copy, DVR, or distributed
  workers.

**Blocking dependencies**

- SIG-010 and a Plex environment available for the manual run.

**Implementation notes**

- The run fails if absolute initial tune drift exceeds 2,000 ms.
- Keeping an HTTP connection open is not evidence that Plex decoded and
  continued across the boundary.
- Make retained code changes and rerun automated tests whenever a tested
  strategy changes runtime behavior.

**Verification**

- A durable results table records environment, arguments, timings, buffer
  behavior, process count, late-join outcome, and boundary playback outcome.
- Both viewers remain visibly playing across the actual file boundary.
- Process inspection confirms viewers share the same worker/encoder pipeline.
- The final viewer disconnect results in verified process closure after the
  selected idle grace.

**Docs impact**

- Update spec 0006 with selected strategies and numeric thresholds/defaults.
- Update spec 0007 with verified Plex-facing behavior.
- Update FFmpeg/startup and stream-safety knowledge-base notes with evidence.
- Change spec 0006 from Draft to Accepted only when all its documented evidence
  requirements are satisfied.

## Phase 3: Production Integration

### SIG-012: Implement the production playout and authorization adapters

**Goal**

Feed workers real provider-neutral state from one consistent schedule snapshot.

**Scope**

- Implement channel authorization for existence/enabled checks.
- Implement `getCurrent()` and `getFollowing()` adapters over the completed
  specs 0002-0005 persistence model.
- Read revision first, then every contributing row through one connection-pinned
  Kysely read transaction.
- Return typed domain projections rather than database rows.
- End a snapshot and request horizon repair/extension before retrying; never
  upgrade the read transaction to a write.

**Out of scope**

- Signal runtime changes, schedule generation policy, and transition writes.

**Blocking dependencies**

- G4: implemented specs 0002-0005 and the SQLite persistence foundation.
- SIG-001 contract shapes.

**Implementation notes**

- A following cursor must exist under the selected channel/revision; do not
  guess after stale data.
- Define `SelectedPlayoutItem.durationMs` in spec 0005 (media playable length
  versus airtime). If it is media length, clamp `playDurationMs` in
  `channel-worker/playout-projection.ts` to `durationMs - mediaOffsetMs` as
  spec 0006 requires for the initial item; neither the current nor the
  following projection clamps today.
- Carry the catalog's required `hasAudio` fact into every
  `SelectedPlayoutItem`; `packages/signal` consumes it but does not probe media.
- Keep this adapter in the server/persistence composition layer, not
  `packages/signal`.

**Verification**

- Repository tests cover enabled, disabled, missing, schedule-gap,
  unavailable-media, current, and following states.
- A two-connection interleave proves every result is complete old or complete
  new state, never a mixed revision/source projection.
- Search confirms `packages/signal` has no SQLite or Kysely import.

**Docs impact**

- Update implementation status for specs 0002-0005 as their owning plans
  require; no boundary change is expected in spec 0006.

### SIG-013: Implement the SQLite TransitionCoordinator adapter

**Goal**

Make schedule regeneration and a worker's prepared transition have one
deterministic winner.

**Scope**

- Use the project-owned connection-pinned `BEGIN IMMEDIATE` helper.
- Obtain boundary time after write authority is acquired.
- Revalidate channel, `scheduleRevision`, and the entry covering boundary time.
- Invoke the synchronous preparation commit before releasing write authority.
- Return `stale` without invoking commit when validation fails.
- Propagate callback failure as worker/session failure.

**Out of scope**

- Schedule generation or signal preparation internals.

**Blocking dependencies**

- SIG-008, SIG-012, and the schedule mutation implementation from spec 0004.

**Implementation notes**

- This adapter belongs with persistence wiring outside `packages/signal`.
- The callback must remain synchronous and must not perform preparation.

**Verification**

- Multi-connection tests force regeneration-first and transition-first
  orderings.
- Regeneration-first never commits stale prepared output.
- Transition-first commits once, and later regeneration preserves the newly
  current item through its existing `endsAt`.
- No test permits a transition before the boundary.

**Docs impact**

- Update ADR 0003 or 0008 only if implementation exposes a decision change.

### SIG-014: Add the provider-neutral HTTP stream route

**Goal**

Expose a readiness-gated `video/MP2T` response whose request lifetime owns only
one subscription, not a worker or encoder.

**Scope**

- Register `GET /channels/:id/stream` or its agreed equivalent in `apps/server`.
- Subscribe through the singleton `ChannelStreamManager`.
- Delay success until manager subscription succeeds.
- Stream `video/MP2T` bytes and close the subscription once across every abort,
  close, and error path.
- Map typed pre-response failures to structured HTTP errors.
- Log post-response worker failures and end the affected stream without trying
  to emit an error body.

**Out of scope**

- Plex discovery, XMLTV/M3U, or provider-owned packaging routes.

**Blocking dependencies**

- SIG-007, SIG-011 defaults, and SIG-012.

**Implementation notes**

- Provider adapters link to this route; they do not wrap it with another
  encoding session.
- Avoid exposing internal media paths in public errors.

**Verification**

- Fastify injection/integration tests cover not found, disabled, no current
  item, invalid state, readiness timeout/failure, success content type, and
  client disconnect.
- Two HTTP clients use one active worker, and closing one leaves the other live.
- No successful response headers/body are committed for startup failure.

**Docs impact**

- Update server/API documentation with route and error shapes.

### SIG-015: Wire administrative stops and server shutdown

**Goal**

Coordinate persisted channel mutations with reliable runtime cleanup.

**Scope**

- After disable/delete commits, invoke and await `stopChannel()` before
  returning success.
- Map cleanup failure to retryable `channel_runtime_cleanup_failed` with
  `persistenceCommitted: true`.
- Retry cleanup for already-disabled or already-deleted channels.
- Prevent re-enable from committing until retained prior cleanup succeeds.
- On server shutdown, reject new subscriptions, settle manager resources, then
  finish persistence/server teardown in the documented order.

**Out of scope**

- Rolling back committed configuration or automatic failed-worker restart.

**Blocking dependencies**

- SIG-007, channel mutation endpoints from spec 0003, and SIG-014 composition
  wiring.

**Implementation notes**

- Persistence remains authoritative after a partial-success cleanup failure.
- Ordinary programming changes must not call `stopChannel()`.

**Verification**

- Disable/delete closes subscribers and processes before a success response.
- Injected cleanup failure preserves the committed mutation and returns the
  retryable partial-success response.
- Repeating the mutation retries remaining cleanup and then succeeds.
- Re-enable is blocked until cleanup completes, then a later tune starts a new
  worker rather than reusing the old one.
- Server shutdown leaves no active/pending worker or FFmpeg process.

**Docs impact**

- Document the operational partial-success response in the channel API spec.

### SIG-016: Close the full spec 0006 acceptance loop

**Goal**

Prove the retained spike-tested runtime works with real kraziBrain state and
server lifecycle wiring.

**Scope**

- Add an end-to-end fixture with persisted channel, media, schedule, playout,
  transition coordinator, stream route, and real FFmpeg.
- Exercise join-in-progress, concurrent viewers, schedule regeneration before a
  boundary, transition to the regenerated selection, disconnect, idle stop,
  disable/delete, and terminal shutdown.
- Audit every acceptance criterion in spec 0006 against automated evidence or
  the recorded manual compatibility result.

**Out of scope**

- Spec 0007 guide/discovery completeness, Web Admin, and deferred streaming
  features.

**Blocking dependencies**

- SIG-011 through SIG-015.

**Implementation notes**

- Keep a traceable checklist rather than copying acceptance wording into tests
  with no evidence link.
- Treat leaked processes, timers, buffers, or subscribers as test failures.

**Verification**

- `npm run format`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Real-FFmpeg integration suite passes on its declared supported environment.
- Manual Plex evidence remains valid for the final retained arguments and
  buffer strategies; rerun the relevant matrix if they changed.

**Docs impact**

- Mark this plan complete.
- Mark spec 0006 Implemented only after every acceptance criterion is accounted
  for and the final runtime still matches the recorded compatibility evidence.

## Suggested First Work Batch

Start with SIG-001 through SIG-004. They establish contracts, fan-out, process
lifecycle, and one real packaging session while keeping the harder worker and
manager state machines testable. SIG-002 and SIG-003 can be implemented
independently after SIG-001; SIG-004 then composes the process primitive, and
SIG-005 becomes the first complete worker startup slice.

Do not begin the manual Plex run before SIG-009. Do not wait for the production
database model to build Phase 1 or the disposable adapters in SIG-010.

## Completion Definition

Spec 0006 is complete when:

- one shared channel worker serves multiple viewers through independently
  bounded subscriber streams;
- the first worker joins within the measured drift ceiling and the broadcast
  stays paced to wall-clock time;
- Plex decodes late joins and remains playing across a real two-file boundary;
- schedule regeneration and transition commitment are race-safe;
- startup, idle, administrative, and terminal shutdown paths leave no owned
  resources behind;
- the provider-neutral HTTP stream route uses real playout state; and
- the accepted spec records the empirical defaults selected by the retained
  compatibility implementation.

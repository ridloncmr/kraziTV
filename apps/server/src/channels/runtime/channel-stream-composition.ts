import {
  createChannelStreamManager,
  type ChannelStreamManagerContract,
  type Clock,
  type SignalPackager,
  type TimerScheduler,
} from "@krazitv/signal";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { PlayoutService } from "../../playout/playout-service.js";
import type { ChannelRepository } from "../repository/channel-repository.js";
import { toSignalLogger } from "./signal-log.js";
import { SignalPlayoutAdapter } from "./signal-playout-adapter.js";
import { SqliteTransitionCoordinator } from "./sqlite-transition-coordinator.js";

// The MVP defaults SIG-011 selected from the Linux/Plex compatibility run;
// spec 0006 records the evidence. Transition recovery and write-authority
// waits keep its 2 s.
const RECOVERY_TIMEOUT_MS = 2_000;
// A first viewer's tune waits for the burst backlog, for at most the
// packager's 10 s hold (ADR 0018); Plex waited out 15 s tunes in testing.
const STARTUP_TIMEOUT_MS = 12_000;
// How far ahead of a boundary the next FFmpeg process starts (ADR 0016): the
// spike measured about 1.7 s to usable output, so this leaves a margin while
// holding only a little over a second of output.
const PREPARE_LEAD_MS = 3_000;
const IDLE_GRACE_MS = 5_000;
// Retention holds the ten-second join backlog (ADR 0018) up to about 12 Mbps;
// at a higher bitrate a viewer simply joins with less. A joining viewer's
// queue starts with that whole replay, so it gets room beyond it before a
// stalled viewer is cut off.
const RETENTION_LIMIT_BYTES = 16 * 1024 * 1024;
const SUBSCRIBER_BUFFER_LIMIT_BYTES = 32 * 1024 * 1024;

interface ChannelStreamCompositionOptions {
  db: Kysely<DatabaseSchema>;
  playout: PlayoutService;
  channels: Pick<ChannelRepository, "findById">;
  log: FastifyBaseLogger;
  /** Where filler's resume time is worded. */
  programmingTimezone: string;
  packager: SignalPackager;
  /** One source for both, so worker sleeps and transition checks agree. */
  runtime: Clock & TimerScheduler;
  /**
   * Tests shorten this to reach the readiness timeout quickly, or lengthen it
   * when startup latency is not what they check. Only startup uses it.
   */
  startupTimeoutMs?: number;
}

/**
 * Builds the server's one channel stream manager from kraziBrain's playout
 * reads and the SQLite transition coordinator, so every viewer of a channel
 * shares one worker.
 */
export function composeChannelStreamManager(
  options: ChannelStreamCompositionOptions,
): ChannelStreamManagerContract {
  const startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  const adapter = new SignalPlayoutAdapter(
    options.playout,
    options.channels,
    options.log,
    options.programmingTimezone,
  );
  return createChannelStreamManager({
    authorization: adapter,
    playoutProvider: adapter,
    packager: options.packager,
    clock: options.runtime,
    timers: options.runtime,
    // The worker's recovery window: giving up sooner would stop a live
    // channel that could still commit its transition in time.
    transitionCoordinator: new SqliteTransitionCoordinator(
      options.db,
      () => options.runtime.now(),
      { writeAuthorityWaitMs: RECOVERY_TIMEOUT_MS },
    ),
    startupTimeoutMs,
    recoveryTimeoutMs: RECOVERY_TIMEOUT_MS,
    prepareLeadMs: PREPARE_LEAD_MS,
    idleGraceMs: IDLE_GRACE_MS,
    logger: toSignalLogger(options.log),
    subscriberBufferLimitBytes: SUBSCRIBER_BUFFER_LIMIT_BYTES,
    retentionLimitBytes: RETENTION_LIMIT_BYTES,
  });
}

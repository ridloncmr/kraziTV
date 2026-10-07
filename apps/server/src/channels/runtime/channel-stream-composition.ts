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
// spec 0006 records the evidence.
const STARTUP_TIMEOUT_MS = 2_000;
const PREPARE_LEAD_MS = 2_000;
const IDLE_GRACE_MS = 5_000;
const BUFFER_LIMIT_BYTES = 4 * 1024 * 1024;

interface ChannelStreamCompositionOptions {
  db: Kysely<DatabaseSchema>;
  playout: PlayoutService;
  channels: Pick<ChannelRepository, "findById">;
  log: FastifyBaseLogger;
  packager: SignalPackager;
  /** One source for both, so worker sleeps and transition checks agree. */
  runtime: Clock & TimerScheduler;
  /**
   * Tests shorten this to reach the readiness timeout quickly, or lengthen it
   * when startup latency is not what they check.
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
      { writeAuthorityWaitMs: startupTimeoutMs },
    ),
    startupTimeoutMs,
    prepareLeadMs: PREPARE_LEAD_MS,
    idleGraceMs: IDLE_GRACE_MS,
    logger: toSignalLogger(options.log),
    subscriberBufferLimitBytes: BUFFER_LIMIT_BYTES,
    retentionLimitBytes: BUFFER_LIMIT_BYTES,
  });
}

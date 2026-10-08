import { createMediaProber } from "@krazitv/media";
import { createFfmpegSignalPackager, SystemRuntime } from "@krazitv/signal";
import { pino } from "pino";

import { buildServer } from "./app.js";
import { AuthService } from "./auth/auth-service.js";
import { resolveDataDirectory } from "./config/data-directory.js";
import { openDatabase } from "./database/database.js";
import { MediaRootRepository } from "./media-roots/media-root-repository.js";
import { MediaItemRepository } from "./media-items/media-item-repository.js";
import { MediaCollectionRepository } from "./media-collections/media-collection-repository.js";
import { ChannelRepository } from "./channels/repository/channel-repository.js";
import { composeChannelStreamManager } from "./channels/runtime/channel-stream-composition.js";
import { toSignalLogger } from "./channels/runtime/signal-log.js";
import { ProgrammingBlockRepository } from "./programming-blocks/programming-block-repository.js";
import { ScheduleService } from "./schedules/schedule-service.js";
import { PlayoutService } from "./playout/playout-service.js";
import { CatalogScanWriter } from "./catalog-scan/writer/catalog-scan-writer.js";
import { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import { ConcurrencyLimitedProber } from "./catalog-scan/scanner/concurrency-limited-prober.js";
import { CatalogRemovalService } from "./catalog-removal/catalog-removal-service.js";
import { parseProbeConfig } from "./config/probe.js";
import { parseFfmpegPath } from "./config/ffmpeg.js";
import { parseTunerConfig } from "./config/tuner.js";
import {
  parseCorsOrigins,
  parseListenConfig,
  parsePublicBaseUrl,
} from "./config/network.js";

const { host, port } = parseListenConfig(process.env);
const publicBaseUrl = parsePublicBaseUrl(process.env.PUBLIC_BASE_URL, port);
const tuner = parseTunerConfig(process.env);
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const dataDirectory = resolveDataDirectory(
  process.env.KRAZITV_DATA_DIR,
  process.cwd(),
);
// Parsed before opening the database so invalid configuration fails fast.
const probeConfig = parseProbeConfig(process.env);
const ffmpegPath = parseFfmpegPath(process.env);
const database = await openDatabase({ dataDirectory });

const auth = new AuthService(database.db);
const mediaRoots = new MediaRootRepository(database.db);
const mediaItems = new MediaItemRepository(database.db);
const mediaCollections = new MediaCollectionRepository(database.db);
const channels = new ChannelRepository(database.db);
const programmingBlocks = new ProgrammingBlockRepository(database.db);
const schedules = new ScheduleService(database.db);
const playout = new PlayoutService(database.db, schedules);

// Created before Fastify so the stream runtime and scan jobs log through the same logger.
const logger = pino();
// Removal asks the scanner whether a root is scanning, and every completed
// scan purges; the closure resolves the scanner when a removal runs.
const catalogRemovals = new CatalogRemovalService(database.db, {
  schedules,
  isScanning: (rootId): boolean => scanner.isScanning(rootId),
});
// One limited prober serves every scan so the ffprobe budget is process-wide.
// Built after schedules and the logger: each completed scan job ensures schedules.
const scanner = new CatalogScanner({
  roots: mediaRoots,
  prober: new ConcurrencyLimitedProber(
    createMediaProber({
      ffprobePath: probeConfig.ffprobePath,
      timeoutMs: probeConfig.timeoutMs,
    }),
    probeConfig.concurrency,
  ),
  writer: new CatalogScanWriter(database.db),
  schedules,
  removals: catalogRemovals,
  log: logger,
});
const runtime = new SystemRuntime();
const channelStreams = composeChannelStreamManager({
  db: database.db,
  playout,
  channels,
  log: logger,
  packager: createFfmpegSignalPackager({
    logger: toSignalLogger(logger),
    timers: runtime,
    ffmpegPath,
  }),
  runtime,
});

const server = buildServer(
  {
    database,
    auth,
    // The gate checks sessions against the same service that issues them.
    authenticator: auth,
    mediaRoots,
    scanner,
    mediaItems,
    mediaCollections,
    catalogRemovals,
    channels,
    // Disable and delete stop the same workers that serve tunes.
    channelRuntime: channelStreams,
    channelStreams,
    programmingBlocks,
    schedules,
    playout,
  },
  {
    loggerInstance: logger,
    plex: { publicBaseUrl, ...tuner },
    ...(corsOrigins ? { corsOrigins } : {}),
  },
);

try {
  await server.listen({ host, port });
} catch (error) {
  await server.close();
  throw error;
}

// Cancels scans, then closes Fastify and SQLite through its hooks, when the operator stops the process.
function shutdown(): void {
  void server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

import { createMediaProber } from "@krazitv/media";
import { createFfmpegSignalPackager, SystemRuntime } from "@krazitv/signal";
import { pino } from "pino";

import { buildServer } from "./app.js";
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
import { parseProbeConfig } from "./config/probe.js";
import { parseFfmpegPath } from "./config/ffmpeg.js";
import {
  isLoopbackHost,
  parseCorsOrigins,
  parseListenConfig,
} from "./config/network.js";

const { host, port } = parseListenConfig(process.env);
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const dataDirectory = resolveDataDirectory(
  process.env.KRAZITV_DATA_DIR,
  process.cwd(),
);
// Parsed before opening the database so invalid configuration fails fast.
const probeConfig = parseProbeConfig(process.env);
const ffmpegPath = parseFfmpegPath(process.env);
const database = await openDatabase({ dataDirectory });

const mediaRoots = new MediaRootRepository(database.db);
// One limited prober serves every scan so the ffprobe budget is process-wide.
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
});

const mediaItems = new MediaItemRepository(database.db);
const mediaCollections = new MediaCollectionRepository(database.db);
const channels = new ChannelRepository(database.db);
const programmingBlocks = new ProgrammingBlockRepository(database.db);
const schedules = new ScheduleService(database.db);
const playout = new PlayoutService(database.db, schedules);

// Created before Fastify so the stream runtime logs through the same logger.
const logger = pino();
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
    mediaRoots,
    scanner,
    mediaItems,
    mediaCollections,
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
    ...(corsOrigins ? { corsOrigins } : {}),
  },
);

if (!isLoopbackHost(host)) {
  server.log.warn(
    "SECURITY WARNING: kraziTV has no authentication. Bind only on a trusted network; connected clients can access mutable administration APIs and local-media scan capabilities.",
  );
}

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

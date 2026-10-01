import { createMediaProber } from "@krazitv/media";

import { buildServer } from "./app.js";
import { resolveDataDirectory } from "./config/data-directory.js";
import { openDatabase } from "./database/database.js";
import { MediaRootRepository } from "./media-roots/media-root-repository.js";
import { MediaItemRepository } from "./media-items/media-item-repository.js";
import { MediaCollectionRepository } from "./media-collections/media-collection-repository.js";
import { CatalogScanWriter } from "./catalog-scan/writer/catalog-scan-writer.js";
import { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import { ConcurrencyLimitedProber } from "./catalog-scan/scanner/concurrency-limited-prober.js";
import { parseProbeConfig } from "./config/probe.js";
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

const server = buildServer(
  { database, mediaRoots, scanner, mediaItems, mediaCollections },
  {
    logger: true,
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

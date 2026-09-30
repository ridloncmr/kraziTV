import { createMediaProber } from "@krazitv/media";

import { buildServer } from "./app.js";
import { resolveDataDirectory } from "./data-directory.js";
import { openDatabase } from "./database/database.js";
import { MediaRootRepository } from "./media-catalog/media-root-repository.js";
import { CatalogScanWriter } from "./media-catalog/scan/catalog-scan-writer.js";
import { CatalogScanner } from "./media-catalog/scan/catalog-scanner.js";
import { ConcurrencyLimitedProber } from "./media-catalog/scan/concurrency-limited-prober.js";
import { parseProbeConfig } from "./media-catalog/scan/probe-config.js";
import { isLoopbackHost, parseCorsOrigins } from "./network.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
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

const server = buildServer(
  { database, mediaRoots, scanner },
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

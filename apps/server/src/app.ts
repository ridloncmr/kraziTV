import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { registerApiErrorHandlers } from "./http/api-error.js";
import type { MediaRootRepository } from "./media-roots/media-root-repository.js";
import { registerMediaRootRoutes } from "./media-roots/media-root-routes.js";
import type { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import { registerCatalogScanRoutes } from "./catalog-scan/routes/catalog-scan-routes.js";
import type { MediaItemRepository } from "./media-items/media-item-repository.js";
import { registerMediaItemRoutes } from "./media-items/media-item-routes.js";
import type { MediaCollectionRepository } from "./media-collections/media-collection-repository.js";
import { registerMediaCollectionRoutes } from "./media-collections/media-collection-routes.js";
import type { ChannelRepository } from "./channels/repository/channel-repository.js";
import type { ChannelRuntime } from "./channels/contracts.js";
import { registerChannelRoutes } from "./channels/routes/channel-routes.js";
import type { ProgrammingBlockRepository } from "./programming-blocks/programming-block-repository.js";
import { registerProgrammingBlockRoutes } from "./programming-blocks/programming-block-routes.js";
import { registerScheduleRoutes } from "./schedules/schedule-routes.js";
import type { ScheduleService } from "./schedules/schedule-service.js";

const DEFAULT_CORS_ORIGINS = ["http://127.0.0.1:5173"];

type BuildServerOptions = FastifyServerOptions & {
  corsOrigins?: string[];
  /** How long a channel disable, delete, or re-enable waits for its runtime stop. */
  channelStopTimeoutMs?: number | undefined;
};

export type ServerDatabaseLifecycle = {
  close(): Promise<void>;
};

export type ServerDependencies = {
  database: ServerDatabaseLifecycle;
  mediaRoots: MediaRootRepository;
  scanner: CatalogScanner;
  mediaItems: MediaItemRepository;
  mediaCollections: MediaCollectionRepository;
  channels: ChannelRepository;
  channelRuntime: ChannelRuntime;
  programmingBlocks: ProgrammingBlockRepository;
  schedules: ScheduleService;
};

/** Registers HTTP behavior without opening production infrastructure. */
function registerRoutes(
  server: FastifyInstance,
  dependencies: ServerDependencies,
  corsOrigins: string[],
  channelStopTimeoutMs: number | undefined,
): void {
  registerApiErrorHandlers(server);
  void server.register(cors, {
    origin: corsOrigins,
  });

  server.get("/health", async () => ({ status: "ok" }));
  registerMediaRootRoutes(server, dependencies.mediaRoots);
  registerCatalogScanRoutes(server, dependencies.scanner);
  registerMediaItemRoutes(server, dependencies.mediaItems);
  registerMediaCollectionRoutes(server, dependencies.mediaCollections);
  registerChannelRoutes(
    server,
    dependencies.channels,
    dependencies.channelRuntime,
    channelStopTimeoutMs,
  );
  registerProgrammingBlockRoutes(
    server,
    dependencies.programmingBlocks,
    dependencies.channels,
    dependencies.schedules,
  );
  registerScheduleRoutes(server, dependencies.schedules);
}

/** Composes Fastify with injected lifecycle dependencies for production or tests. */
export function buildServer(
  dependencies: ServerDependencies,
  options: BuildServerOptions = {},
) {
  const {
    corsOrigins = DEFAULT_CORS_ORIGINS,
    channelStopTimeoutMs,
    ...fastifyOptions
  } = options;
  const server = Fastify(fastifyOptions);

  // Scans are cancelled first so in-flight requests can answer and every ffprobe
  // child closes before onClose releases the database they would commit to.
  server.addHook("preClose", async () => {
    await dependencies.scanner.shutdown();
  });

  server.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  registerRoutes(server, dependencies, corsOrigins, channelStopTimeoutMs);

  return server;
}

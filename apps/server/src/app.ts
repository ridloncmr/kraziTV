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
import type { ChannelRuntime, ChannelStreams } from "./channels/contracts.js";
import { registerChannelRoutes } from "./channels/routes/channel-routes.js";
import { registerChannelStreamRoutes } from "./channels/routes/channel-stream-routes.js";
import type { ProgrammingBlockRepository } from "./programming-blocks/programming-block-repository.js";
import { registerProgrammingBlockRoutes } from "./programming-blocks/programming-block-routes.js";
import { registerPlayoutRoutes } from "./playout/playout-routes.js";
import { registerPlexRoutes, type PlexSettings } from "./plex/plex-routes.js";
import type { PlayoutService } from "./playout/playout-service.js";
import { registerScheduleRoutes } from "./schedules/schedule-routes.js";
import type { ScheduleService } from "./schedules/schedule-service.js";

const DEFAULT_CORS_ORIGINS = ["http://127.0.0.1:5173"];

type BuildServerOptions = FastifyServerOptions & {
  corsOrigins?: string[];
  /** How long a channel disable, delete, or re-enable waits for its runtime stop. */
  channelStopTimeoutMs?: number | undefined;
  /** Required so Plex URLs always come from parsed configuration, never a second default. */
  plex: PlexSettings;
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
  channelStreams: ChannelStreams;
  programmingBlocks: ProgrammingBlockRepository;
  schedules: ScheduleService;
  playout: PlayoutService;
};

/** Registers HTTP behavior without opening production infrastructure. */
function registerRoutes(
  server: FastifyInstance,
  dependencies: ServerDependencies,
  corsOrigins: string[],
  channelStopTimeoutMs: number | undefined,
  plex: PlexSettings,
): void {
  registerApiErrorHandlers(server);
  // @fastify/cors allows only GET, HEAD and POST by default; the Web UI also edits and deletes.
  void server.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });

  server.get("/health", async () => ({ status: "ok" }));
  registerMediaRootRoutes(server, dependencies.mediaRoots);
  registerCatalogScanRoutes(
    server,
    dependencies.scanner,
    dependencies.schedules,
  );
  registerMediaItemRoutes(server, dependencies.mediaItems);
  registerMediaCollectionRoutes(
    server,
    dependencies.mediaCollections,
    dependencies.schedules,
  );
  registerChannelRoutes(
    server,
    dependencies.channels,
    dependencies.channelRuntime,
    dependencies.schedules,
    channelStopTimeoutMs,
  );
  registerChannelStreamRoutes(server, dependencies.channelStreams);
  registerProgrammingBlockRoutes(
    server,
    dependencies.programmingBlocks,
    dependencies.channels,
    dependencies.schedules,
  );
  registerScheduleRoutes(server, dependencies.schedules);
  registerPlayoutRoutes(server, dependencies.playout);
  registerPlexRoutes(
    server,
    dependencies.channels,
    dependencies.schedules,
    plex,
  );
}

/** Composes Fastify with injected lifecycle dependencies for production or tests. */
export function buildServer(
  dependencies: ServerDependencies,
  options: BuildServerOptions,
) {
  const {
    corsOrigins = DEFAULT_CORS_ORIGINS,
    channelStopTimeoutMs,
    plex,
    ...fastifyOptions
  } = options;
  const server = Fastify(fastifyOptions);

  // Scans are cancelled first so in-flight requests can answer and every ffprobe
  // child closes before onClose releases the database they would commit to.
  // Channel streams shut down here too: a live stream response never ends on
  // its own, so the server could not finish closing while one is open. Both
  // steps settle before the database closes, even when one fails; a failure
  // is logged, not thrown, so shutdown still completes.
  server.addHook("preClose", async () => {
    const results = await Promise.allSettled([
      dependencies.scanner.shutdown(),
      dependencies.channelStreams.shutdown(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        server.log.error({ err: result.reason }, "Shutdown step failed");
      }
    }
  });

  // Repairs schedules that lapsed while the server was down before it serves
  // traffic; ensureAllEnabled logs failures instead of blocking startup.
  server.addHook("onReady", async () => {
    await dependencies.schedules.ensureAllEnabled(server.log);
  });

  server.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  registerRoutes(server, dependencies, corsOrigins, channelStopTimeoutMs, plex);

  return server;
}

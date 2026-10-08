import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  type RouteOptions,
} from "fastify";

import type { AuthService } from "./auth/auth-service.js";
import type { RequestAuthenticator } from "./auth/contracts.js";
import { registerAuthGate } from "./auth/gate/auth-gate.js";
import { registerAuthRoutes } from "./auth/routes/auth-routes.js";
import { registerApiErrorHandlers } from "./http/api-error.js";
import type { MediaRootRepository } from "./media-roots/media-root-repository.js";
import { registerMediaRootRoutes } from "./media-roots/media-root-routes.js";
import type { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import { registerCatalogScanRoutes } from "./catalog-scan/routes/catalog-scan-routes.js";
import { toApiScanStatus } from "./catalog-scan/routes/api-scan-status.js";
import type { CatalogRemovalService } from "./catalog-removal/catalog-removal-service.js";
import { registerCatalogRemovalRoutes } from "./catalog-removal/routes/catalog-removal-routes.js";
import type { MediaItemRepository } from "./media-items/media-item-repository.js";
import { registerMediaItemRoutes } from "./media-items/media-item-routes.js";
import type { MediaCollectionRepository } from "./media-collections/media-collection-repository.js";
import { registerMediaCollectionRoutes } from "./media-collections/media-collection-routes.js";
import type { ChannelRepository } from "./channels/repository/channel-repository.js";
import type { ChannelRuntime, ChannelStreams } from "./channels/contracts.js";
import { registerChannelRoutes } from "./channels/routes/channel-routes.js";
import { ChannelLifecycleLock } from "./channels/runtime/channel-lifecycle-lock.js";
import {
  DEFAULT_CHANNEL_STOP_TIMEOUT_MS,
  stopChannelUnderLock,
} from "./channels/runtime/settle-runtime-stop.js";
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
  /** How long a channel disable, delete, re-enable, or interrupt waits for its runtime stop. */
  channelStopTimeoutMs?: number | undefined;
  /** Required so Plex URLs always come from parsed configuration, never a second default. */
  plex: PlexSettings;
  /**
   * Observes every route as it registers, before the first one, so a test can
   * prove each route was decided public or gated.
   */
  onRoute?: ((route: RouteOptions) => void) | undefined;
};

export type ServerDatabaseLifecycle = {
  close(): Promise<void>;
};

export type ServerDependencies = {
  database: ServerDatabaseLifecycle;
  auth: AuthService;
  /** What the auth gate asks; production passes the same service as `auth`. */
  authenticator: RequestAuthenticator;
  mediaRoots: MediaRootRepository;
  scanner: CatalogScanner;
  mediaItems: MediaItemRepository;
  mediaCollections: MediaCollectionRepository;
  catalogRemovals: CatalogRemovalService;
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
  channelStopTimeoutMs: number,
  plex: PlexSettings,
): void {
  registerApiErrorHandlers(server);
  // One lock per server, so every route that stops a channel's runtime
  // serializes with every other lifecycle change of that channel.
  const lifecycle = new ChannelLifecycleLock();
  // @fastify/cors allows only GET, HEAD and POST by default; the Web UI also
  // edits and deletes. Credentials let the web app send its session cookie.
  void server.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  });
  // After CORS and before every route; see registerAuthGate.
  registerAuthGate(server, dependencies.authenticator);

  server.get("/health", async () => ({ status: "ok" }));
  registerAuthRoutes(server, dependencies.auth, {
    // The public base URL is the origin browsers reach kraziTV at too.
    secureCookie: new URL(plex.publicBaseUrl).protocol === "https:",
  });
  registerMediaRootRoutes(
    server,
    dependencies.mediaRoots,
    (rootId) => {
      const status = dependencies.scanner.status(rootId);
      return status === undefined ? null : toApiScanStatus(status);
    },
    (pathKey) => dependencies.catalogRemovals.reclaimRemovedPath(pathKey),
  );
  registerCatalogScanRoutes(
    server,
    dependencies.scanner,
    dependencies.mediaRoots,
  );
  registerMediaItemRoutes(server, dependencies.mediaItems);
  registerCatalogRemovalRoutes(
    server,
    dependencies.catalogRemovals,
    (channelId, log) =>
      stopChannelUnderLock(
        lifecycle,
        dependencies.channelRuntime,
        channelStopTimeoutMs,
        log,
        { channelId, reason: "interrupted" },
      ),
  );
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
    lifecycle,
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
    channelStopTimeoutMs = DEFAULT_CHANNEL_STOP_TIMEOUT_MS,
    plex,
    onRoute,
    ...fastifyOptions
  } = options;
  const server = Fastify(fastifyOptions);
  if (onRoute !== undefined) server.addHook("onRoute", onRoute);

  // Scan jobs are cancelled first so every ffprobe child closes, and a
  // committing job finishes, before onClose releases the database.
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

  // Purges removed media whose airing ended while the server was down, then
  // repairs schedules that lapsed, before it serves traffic. Both log
  // failures instead of blocking startup.
  server.addHook("onReady", async () => {
    await dependencies.catalogRemovals.purge(server.log);
    await dependencies.schedules.ensureAllEnabled(server.log);
  });

  server.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  registerRoutes(server, dependencies, corsOrigins, channelStopTimeoutMs, plex);

  return server;
}

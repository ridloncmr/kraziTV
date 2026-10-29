import cors from "@fastify/cors";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
  type RouteOptions,
} from "fastify";

import type { AuthService } from "./auth/auth-service.js";
import type { RequestAuthenticator } from "./auth/contracts.js";
import { registerAuthGate } from "./auth/gate/auth-gate.js";
import { withLoopbackAliases } from "./auth/gate/request-origin.js";
import { registerAccountRoutes } from "./auth/routes/account-routes.js";
import { registerAuthRoutes } from "./auth/routes/auth-routes.js";
import { registerApiErrorHandlers } from "./http/api-error.js";
import { registerTmdbKeyRoutes } from "./content-metadata/tmdb-key/tmdb-key-routes.js";
import type { TmdbKeyService } from "./content-metadata/tmdb-key/tmdb-key-service.js";
import { registerMatchChoiceRoutes } from "./content-metadata/match-choice/match-choice-routes.js";
import type { MatchChoiceService } from "./content-metadata/match-choice/match-choice-service.js";
import { registerCorrectionRoutes } from "./content-metadata/corrections/correction-routes.js";
import type { CorrectionService } from "./content-metadata/corrections/correction-service.js";
import { registerTrackMappingRoutes } from "./content-metadata/track-mapping/track-mapping-routes.js";
import type { TrackMappingService } from "./content-metadata/track-mapping/track-mapping-service.js";
import type { MetadataRefreshService } from "./content-metadata/refresh/metadata-refresh-service.js";
import type { MediaRootRepository } from "./media-roots/media-root-repository.js";
import { registerMediaRootRoutes } from "./media-roots/media-root-routes.js";
import type { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import { registerCatalogScanRoutes } from "./catalog-scan/routes/catalog-scan-routes.js";
import { toApiScanStatus } from "./catalog-scan/routes/api-scan-status.js";
import type { CatalogRemovalService } from "./catalog-removal/catalog-removal-service.js";
import { registerCatalogRemovalRoutes } from "./catalog-removal/routes/catalog-removal-routes.js";
import type { MediaItemRepository } from "./media-items/media-item-repository.js";
import { registerMediaItemRoutes } from "./media-items/media-item-routes.js";
import type { CollectionMaintenance } from "./media-collections/maintenance/collection-maintenance.js";
import type { MediaCollectionRepository } from "./media-collections/persistence/media-collection-repository.js";
import { registerMediaCollectionRoutes } from "./media-collections/routes/media-collection-routes.js";
import { registerCollectionExclusionRoutes } from "./media-collections/routes/collection-exclusion-routes.js";
import { registerRecommendationRoutes } from "./media-collections/routes/recommendation-routes.js";
import type { ChannelRepository } from "./channels/repository/channel-repository.js";
import type { ChannelRuntime, ChannelStreams } from "./channels/contracts.js";
import { registerChannelRoutes } from "./channels/routes/channel-routes.js";
import { ChannelLifecycleLock } from "./channels/runtime/channel-lifecycle-lock.js";
import {
  DEFAULT_CHANNEL_STOP_TIMEOUT_MS,
  stopChannelUnderLock,
  type StopInterrupted,
} from "./channels/runtime/settle-runtime-stop.js";
import { registerChannelStreamRoutes } from "./channels/routes/channel-stream-routes.js";
import type { AssignmentRepository } from "./programming-assignments/persistence/assignment-repository.js";
import { registerAssignmentRoutes } from "./programming-assignments/routes/assignment-routes.js";
import { registerMarathonSettingsRoutes } from "./programming-assignments/routes/marathon-settings-routes.js";
import { registerProgrammingPreviewRoutes } from "./programming-assignments/routes/programming-preview-routes.js";
import { registerProgrammingRebuildRoutes } from "./programming-assignments/routes/programming-rebuild-routes.js";
import type { RuleRepository } from "./programming-rules/rule-repository.js";
import { registerRuleRoutes } from "./programming-rules/rule-routes.js";
import type { ReservationRepository } from "./reservations/persistence/reservation-repository.js";
import { registerReservationRoutes } from "./reservations/routes/reservation-routes.js";
import { registerPlayoutRoutes } from "./playout/routes/playout-routes.js";
import { registerPlexRoutes, type PlexSettings } from "./plex/plex-routes.js";
import type { PlayoutService } from "./playout/playout-service.js";
import { registerScheduleRoutes } from "./schedules/routes/schedule-routes.js";
import type { SchedulePreview } from "./schedules/preview/schedule-preview.js";
import type { ScheduleService } from "./schedules/schedule-service.js";
import { registerWebAppRoutes } from "./web-app/web-app-routes.js";

const DEFAULT_CORS_ORIGINS = ["http://127.0.0.1:5173"];

type BuildServerOptions = FastifyServerOptions & {
  /** Normalized browser origins, as parseCorsOrigins returns them. */
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
  /** The built web app to serve at `/`; left out, the server is API-only. */
  webAppDirectory?: string | undefined;
};

export type ServerDatabaseLifecycle = {
  close(): Promise<void>;
};

export type ServerDependencies = {
  database: ServerDatabaseLifecycle;
  auth: AuthService;
  /** What the auth gate asks; production passes the same service as `auth`. */
  authenticator: RequestAuthenticator;
  tmdbKeys: TmdbKeyService;
  matchChoices: MatchChoiceService;
  corrections: CorrectionService;
  trackMappings: TrackMappingService;
  /** Started once the server is ready and shut down before the database closes. */
  metadataRefresh: Pick<MetadataRefreshService, "checkNow" | "shutdown">;
  mediaRoots: MediaRootRepository;
  scanner: CatalogScanner;
  mediaItems: MediaItemRepository;
  mediaCollections: MediaCollectionRepository;
  /** Passes once at boot, and stops before the database closes. */
  collectionMaintenance: Pick<CollectionMaintenance, "request" | "shutdown">;
  catalogRemovals: CatalogRemovalService;
  channels: ChannelRepository;
  channelRuntime: ChannelRuntime;
  channelStreams: ChannelStreams;
  assignments: AssignmentRepository;
  rules: RuleRepository;
  reservations: ReservationRepository;
  schedules: ScheduleService;
  /** Reads windows and previews on the same clock and timezone as `schedules`. */
  schedulePreview: SchedulePreview;
  playout: PlayoutService;
};

/**
 * Regenerates channels with rules once when the server starts under a
 * different programming timezone than schedules were generated in. A
 * failure is logged, not thrown: the timezone stays unrecorded, so the next
 * startup tries again, and startup still ensures coverage.
 */
async function applyProgrammingTimezone(
  schedules: ScheduleService,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const result = await schedules.applyProgrammingTimezone(log);
    if (result?.kind === "changed") {
      log.info(
        {
          previous: result.previous,
          programmingTimezone: schedules.programmingTimezone(),
          channelIds: result.channelIds,
        },
        "Programming timezone changed; regenerated channels with rules",
      );
    }
  } catch (err) {
    log.warn({ err }, "Applying the programming timezone change failed");
  }
}

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
  // The public base URL is the origin browsers reach kraziTV at too, so it
  // decides the cookie's Secure flag and is always an allowed write origin.
  const publicOrigin = new URL(plex.publicBaseUrl);
  const secureCookie = publicOrigin.protocol === "https:";
  const allowedOrigins = new Set([
    ...withLoopbackAliases(publicOrigin.origin),
    ...corsOrigins,
  ]);
  // After CORS and before every route; see registerAuthGate.
  registerAuthGate(server, dependencies.authenticator, {
    allowedOrigins,
    secureCookie,
  });

  server.get("/health", async () => ({ status: "ok" }));
  registerAuthRoutes(server, dependencies.auth, {
    secureCookie,
    allowedOrigins,
    publicBaseUrl: plex.publicBaseUrl,
  });
  registerAccountRoutes(server, dependencies.auth);
  registerTmdbKeyRoutes(server, dependencies.tmdbKeys);
  registerMatchChoiceRoutes(
    server,
    dependencies.matchChoices,
    dependencies.mediaItems,
  );
  registerCorrectionRoutes(
    server,
    dependencies.corrections,
    dependencies.mediaItems,
  );
  registerTrackMappingRoutes(server, dependencies.trackMappings);
  registerMediaRootRoutes(
    server,
    dependencies.mediaRoots,
    (rootId) => {
      const status = dependencies.scanner.status(rootId);
      return status === undefined ? null : toApiScanStatus(status);
    },
    () => dependencies.mediaItems.countMatchesByRoot(),
    (pathKey) => dependencies.catalogRemovals.reclaimRemovedPath(pathKey),
  );
  registerCatalogScanRoutes(
    server,
    dependencies.scanner,
    dependencies.mediaRoots,
  );
  registerMediaItemRoutes(server, dependencies.mediaItems);
  // Stops a channel's worker after a change the owner chose to interrupt.
  const stopInterrupted: StopInterrupted = (channelId, log) =>
    stopChannelUnderLock(
      lifecycle,
      dependencies.channelRuntime,
      channelStopTimeoutMs,
      log,
      { channelId, reason: "interrupted" },
    );
  registerCatalogRemovalRoutes(
    server,
    dependencies.catalogRemovals,
    stopInterrupted,
  );
  registerMediaCollectionRoutes(
    server,
    dependencies.mediaCollections,
    dependencies.schedules,
  );
  registerCollectionExclusionRoutes(
    server,
    dependencies.mediaCollections,
    dependencies.schedules,
  );
  registerRecommendationRoutes(server, dependencies.mediaCollections);
  registerChannelRoutes(
    server,
    dependencies.channels,
    dependencies.channelRuntime,
    dependencies.schedules,
    lifecycle,
    channelStopTimeoutMs,
  );
  registerChannelStreamRoutes(server, dependencies.channelStreams);
  registerAssignmentRoutes(
    server,
    dependencies.assignments,
    dependencies.channels,
    dependencies.schedules,
    dependencies.schedulePreview,
  );
  registerRuleRoutes(
    server,
    dependencies.rules,
    dependencies.channels,
    dependencies.schedules,
  );
  registerReservationRoutes(
    server,
    dependencies.reservations,
    dependencies.channels,
    dependencies.schedules,
    dependencies.schedulePreview,
    dependencies.channelRuntime,
  );
  registerMarathonSettingsRoutes(
    server,
    dependencies.assignments,
    dependencies.channels,
    dependencies.schedules,
  );
  registerProgrammingPreviewRoutes(server, dependencies.schedulePreview);
  registerProgrammingRebuildRoutes(
    server,
    dependencies.schedules,
    stopInterrupted,
  );
  registerScheduleRoutes(
    server,
    dependencies.schedules,
    dependencies.schedulePreview,
    dependencies.mediaItems,
  );
  registerPlayoutRoutes(server, dependencies.playout, dependencies.schedules);
  registerPlexRoutes(
    server,
    dependencies.channels,
    dependencies.schedules,
    dependencies.schedulePreview,
    dependencies.mediaItems,
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
    webAppDirectory,
    ...fastifyOptions
  } = options;
  const server = Fastify(fastifyOptions);
  if (onRoute !== undefined) server.addHook("onRoute", onRoute);

  // Scan jobs are cancelled first so every ffprobe child closes, and a
  // committing job finishes, before onClose releases the database. The TMDB
  // refresh stops the same way, finishing a commit already under way, and
  // so does collection maintenance.
  // Channel streams shut down here too: a live stream response never ends on
  // its own, so the server could not finish closing while one is open. Both
  // steps settle before the database closes, even when one fails; a failure
  // is logged, not thrown, so shutdown still completes.
  server.addHook("preClose", async () => {
    const results = await Promise.allSettled([
      dependencies.scanner.shutdown(),
      dependencies.metadataRefresh.shutdown(),
      dependencies.collectionMaintenance.shutdown(),
      dependencies.channelStreams.shutdown(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        server.log.error({ err: result.reason }, "Shutdown step failed");
      }
    }
  });

  // Deletes sessions that expired while the server was down, purges removed
  // media whose airing ended meanwhile, then repairs schedules that lapsed,
  // before it serves traffic, and starts the TMDB refresh and a collection
  // maintenance pass. Each logs failures instead of blocking startup.
  server.addHook("onReady", async () => {
    await dependencies.auth.deleteExpiredSessions(server.log);
    await dependencies.catalogRemovals.purge(server.log);
    await applyProgrammingTimezone(dependencies.schedules, server.log);
    await dependencies.schedules.ensureAllEnabled(server.log);
    // Runs in the background, so a slow TMDB never delays startup.
    dependencies.metadataRefresh.checkNow();
    // Converges automatic collections with facts committed while the server
    // was down, or by a pass that failed before it stopped.
    void dependencies.collectionMaintenance.request();
  });

  server.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  registerRoutes(server, dependencies, corsOrigins, channelStopTimeoutMs, plex);
  if (webAppDirectory !== undefined) {
    registerWebAppRoutes(server, webAppDirectory);
  }

  return server;
}

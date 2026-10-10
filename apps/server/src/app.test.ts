import { afterEach, describe, expect, it } from "vitest";

import {
  buildServer,
  type ServerDependencies,
  type ServerDatabaseLifecycle,
} from "./app.js";
import type { AuthService } from "./auth/auth-service.js";
import type { MatchChoiceService } from "./content-metadata/match-choice/match-choice-service.js";
import type { CorrectionService } from "./content-metadata/corrections/correction-service.js";
import type { TrackMappingService } from "./content-metadata/track-mapping/track-mapping-service.js";
import type { TmdbKeyService } from "./content-metadata/tmdb-key/tmdb-key-service.js";
import type { MediaRootRepository } from "./media-roots/media-root-repository.js";
import type { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import type { ScanStatus } from "./catalog-scan/contracts.js";
import type { MediaItemRepository } from "./media-items/media-item-repository.js";
import type { MediaCollectionRepository } from "./media-collections/media-collection-repository.js";
import type { CatalogRemovalService } from "./catalog-removal/catalog-removal-service.js";
import type { ChannelRepository } from "./channels/repository/channel-repository.js";
import type { ProgrammingBlockRepository } from "./programming-blocks/programming-block-repository.js";
import type { PlayoutService } from "./playout/playout-service.js";
import type { ScheduleService } from "./schedules/schedule-service.js";
import type { ChannelStreams } from "./channels/contracts.js";
import { captureLogLines } from "./testing/captured-log-lines.js";
import { ControlledChannelStreams } from "./testing/controlled-channel-streams.js";
import { plexSettingsFixture } from "./testing/plex-fixtures.js";
import { IdleMetadataRefresh } from "./testing/idle-metadata-refresh.js";
import { SignedInAuthenticator } from "./testing/signed-in-authenticator.js";

const servers: ReturnType<typeof buildServer>[] = [];

function createDependencies(
  database: ServerDatabaseLifecycle = { close: async () => undefined },
  scanner: Pick<CatalogScanner, "shutdown"> = {
    shutdown: async () => undefined,
  },
  channelStreams: ChannelStreams = new ControlledChannelStreams(),
): ServerDependencies {
  // These tests never reach catalog or channel routes, so unused stand-ins are
  // enough; schedules still answers the startup ensure.
  return {
    database,
    auth: {
      deleteExpiredSessions: async () => undefined,
    } as Partial<AuthService> as AuthService,
    authenticator: new SignedInAuthenticator(),
    tmdbKeys: {} as TmdbKeyService,
    matchChoices: {} as MatchChoiceService,
    corrections: {} as CorrectionService,
    trackMappings: {} as TrackMappingService,
    metadataRefresh: new IdleMetadataRefresh(),
    mediaRoots: {} as MediaRootRepository,
    scanner: scanner as CatalogScanner,
    mediaItems: {} as MediaItemRepository,
    mediaCollections: {} as MediaCollectionRepository,
    catalogRemovals: {
      purge: async () => undefined,
    } as Partial<CatalogRemovalService> as CatalogRemovalService,
    channels: {} as ChannelRepository,
    channelRuntime: { stopChannel: async () => undefined },
    channelStreams,
    programmingBlocks: {} as ProgrammingBlockRepository,
    schedules: {
      ensureAllEnabled: async () => undefined,
    } as Partial<ScheduleService> as ScheduleService,
    playout: {} as PlayoutService,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("buildServer", () => {
  it("serves the health endpoint through request injection", async () => {
    const server = buildServer(createDependencies(), {
      logger: false,
      plex: plexSettingsFixture,
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("answers unknown routes with the structured error envelope", async () => {
    const server = buildServer(createDependencies(), {
      logger: false,
      plex: plexSettingsFixture,
    });
    servers.push(server);

    const response = await server.inject({
      method: "DELETE",
      url: "/media-roots/root-001",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "not_found", message: expect.any(String) },
    });
  });

  it("allows the local Web UI origin", async () => {
    const server = buildServer(createDependencies(), {
      logger: false,
      plex: plexSettingsFixture,
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://127.0.0.1:5173" },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:5173",
    );
  });

  it.each(["PATCH", "PUT", "DELETE"])(
    "lets the local Web UI preflight %s writes",
    async (method) => {
      const server = buildServer(createDependencies(), {
        logger: false,
        plex: plexSettingsFixture,
      });
      servers.push(server);

      const response = await server.inject({
        method: "OPTIONS",
        url: "/channels/any",
        headers: {
          origin: "http://127.0.0.1:5173",
          "access-control-request-method": method,
          "access-control-request-headers": "content-type",
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-methods"]).toContain(
        method,
      );
    },
  );

  it("does not allow an unconfigured browser origin", async () => {
    const server = buildServer(createDependencies(), {
      logger: false,
      plex: plexSettingsFixture,
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("closes the database lifecycle when Fastify shuts down", async () => {
    let closeCount = 0;
    const database: ServerDatabaseLifecycle = {
      close: async () => {
        closeCount += 1;
      },
    };
    const server = buildServer(createDependencies(database), {
      logger: false,
      plex: plexSettingsFixture,
    });

    await server.close();

    expect(closeCount).toBe(1);
  });

  it("lists each media root with the scanner's status in wire form", async () => {
    const dependencies = createDependencies();
    const root = {
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      lastScannedAt: null,
    };
    dependencies.mediaRoots = {
      list: async () => [
        { ...root, id: "root-scanned", path: "/media/a" },
        { ...root, id: "root-idle", path: "/media/b" },
      ],
    } as Partial<MediaRootRepository> as MediaRootRepository;
    const status: ScanStatus = {
      id: "scan-1",
      rootId: "root-scanned",
      kind: "scan",
      phase: "probing",
      startedAt: Date.UTC(2024, 0, 1),
      finishedAt: null,
      discoveredCount: 3,
      settledCount: 1,
      probeFailedCount: 0,
      currentPath: "/media/a/x.mkv",
      lookupCount: 0,
      lookedUpCount: 0,
      currentTitle: null,
      cancelRequested: false,
      summary: null,
      error: null,
    };
    dependencies.scanner = {
      shutdown: async () => undefined,
      status: (rootId: string) =>
        rootId === status.rootId ? status : undefined,
    } as Partial<CatalogScanner> as CatalogScanner;
    const server = buildServer(dependencies, {
      logger: false,
      plex: plexSettingsFixture,
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/media-roots",
    });

    expect(response.json()).toEqual([
      expect.objectContaining({
        id: "root-scanned",
        scan: { ...status, startedAt: "2024-01-01T00:00:00.000Z" },
      }),
      expect.objectContaining({ id: "root-idle", scan: null }),
    ]);
  });

  it("stops catalog scans before closing the database on shutdown", async () => {
    const events: string[] = [];
    const server = buildServer(
      createDependencies(
        { close: async () => void events.push("database closed") },
        { shutdown: async () => void events.push("scanner stopped") },
      ),
      { logger: false, plex: plexSettingsFixture },
    );

    await server.close();

    expect(events).toEqual(["scanner stopped", "database closed"]);
  });

  it("starts the TMDB refresh once ready and stops it before closing the database", async () => {
    const events: string[] = [];
    const dependencies = createDependencies({
      close: async () => void events.push("database closed"),
    });
    dependencies.metadataRefresh = new IdleMetadataRefresh(events);
    const server = buildServer(dependencies, {
      logger: false,
      plex: plexSettingsFixture,
    });

    await server.ready();
    await server.close();

    expect(events).toEqual([
      "refresh started",
      "refresh stopped",
      "database closed",
    ]);
  });

  it("waits for scans and logs the failure when channel streams fail to shut down", async () => {
    const events: string[] = [];
    const { lines, stream } = captureLogLines();
    const server = buildServer(
      createDependencies(
        { close: async () => void events.push("database closed") },
        {
          shutdown: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            events.push("scanner stopped");
          },
        },
        {
          subscribe: () => Promise.reject(new Error("unused")),
          shutdown: () => Promise.reject(new Error("FFmpeg did not exit")),
        },
      ),
      { logger: { level: "error", stream }, plex: plexSettingsFixture },
    );

    await server.close();

    expect(events).toEqual(["scanner stopped", "database closed"]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "Shutdown step failed",
        err: expect.objectContaining({ message: "FFmpeg did not exit" }),
      }),
    );
  });
});

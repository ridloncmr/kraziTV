import { afterEach, describe, expect, it } from "vitest";

import {
  buildServer,
  type ServerDependencies,
  type ServerDatabaseLifecycle,
} from "./app.js";
import type { MediaRootRepository } from "./media-roots/media-root-repository.js";
import type { CatalogScanner } from "./catalog-scan/scanner/catalog-scanner.js";
import type { MediaItemRepository } from "./media-items/media-item-repository.js";
import type { MediaCollectionRepository } from "./media-collections/media-collection-repository.js";

const servers: ReturnType<typeof buildServer>[] = [];

function createDependencies(
  database: ServerDatabaseLifecycle = { close: async () => undefined },
  scanner: Pick<CatalogScanner, "shutdown"> = {
    shutdown: async () => undefined,
  },
): ServerDependencies {
  // These tests never reach media-catalog routes, so unused stand-ins are enough.
  return {
    database,
    mediaRoots: {} as MediaRootRepository,
    scanner: scanner as CatalogScanner,
    mediaItems: {} as MediaItemRepository,
    mediaCollections: {} as MediaCollectionRepository,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("buildServer", () => {
  it("serves the health endpoint through request injection", async () => {
    const server = buildServer(createDependencies(), { logger: false });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("answers unknown routes with the structured error envelope", async () => {
    const server = buildServer(createDependencies(), { logger: false });
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
    const server = buildServer(createDependencies(), { logger: false });
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

  it("does not allow an unconfigured browser origin", async () => {
    const server = buildServer(createDependencies(), { logger: false });
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
    const server = buildServer(createDependencies(database), { logger: false });

    await server.close();

    expect(closeCount).toBe(1);
  });

  it("stops catalog scans before closing the database on shutdown", async () => {
    const events: string[] = [];
    const server = buildServer(
      createDependencies(
        { close: async () => void events.push("database closed") },
        { shutdown: async () => void events.push("scanner stopped") },
      ),
      { logger: false },
    );

    await server.close();

    expect(events).toEqual(["scanner stopped", "database closed"]);
  });
});

import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { registerApiErrorHandlers } from "./api-error.js";
import type { MediaRootRepository } from "./media-catalog/media-root-repository.js";
import { registerMediaRootRoutes } from "./media-catalog/media-root-routes.js";
import type { CatalogScanner } from "./media-catalog/scan/catalog-scanner.js";
import { registerCatalogScanRoutes } from "./media-catalog/scan/catalog-scan-routes.js";

const DEFAULT_CORS_ORIGINS = ["http://127.0.0.1:5173"];

export type BuildServerOptions = FastifyServerOptions & {
  corsOrigins?: string[];
};

export type ServerDatabaseLifecycle = {
  close(): Promise<void>;
};

export type ServerDependencies = {
  database: ServerDatabaseLifecycle;
  mediaRoots: MediaRootRepository;
  scanner: CatalogScanner;
};

/** Registers HTTP behavior without opening production infrastructure. */
function registerRoutes(
  server: FastifyInstance,
  dependencies: ServerDependencies,
  corsOrigins: string[],
): void {
  registerApiErrorHandlers(server);
  void server.register(cors, {
    origin: corsOrigins,
  });

  server.get("/health", async () => ({ status: "ok" }));
  registerMediaRootRoutes(server, dependencies.mediaRoots);
  registerCatalogScanRoutes(server, dependencies.scanner);
}

/** Composes Fastify with injected lifecycle dependencies for production or tests. */
export function buildServer(
  dependencies: ServerDependencies,
  options: BuildServerOptions = {},
) {
  const { corsOrigins = DEFAULT_CORS_ORIGINS, ...fastifyOptions } = options;
  const server = Fastify(fastifyOptions);

  // Scans are cancelled first so in-flight requests can answer and every ffprobe
  // child closes before onClose releases the database they would commit to.
  server.addHook("preClose", async () => {
    await dependencies.scanner.shutdown();
  });

  server.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  registerRoutes(server, dependencies, corsOrigins);

  return server;
}

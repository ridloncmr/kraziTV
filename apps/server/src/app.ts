import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

const DEFAULT_CORS_ORIGINS = ["http://127.0.0.1:5173"];

export type BuildServerOptions = FastifyServerOptions & {
  corsOrigins?: string[];
};

export type ServerDatabaseLifecycle = {
  close(): Promise<void>;
};

export type ServerDependencies = {
  database: ServerDatabaseLifecycle;
};

/** Registers HTTP behavior without opening production infrastructure. */
function registerRoutes(server: FastifyInstance, corsOrigins: string[]): void {
  void server.register(cors, {
    origin: corsOrigins,
  });

  server.get("/health", async () => ({ status: "ok" }));
}

/** Composes Fastify with injected lifecycle dependencies for production or tests. */
export function buildServer(
  dependencies: ServerDependencies,
  options: BuildServerOptions = {},
) {
  const { corsOrigins = DEFAULT_CORS_ORIGINS, ...fastifyOptions } = options;
  const server = Fastify(fastifyOptions);

  server.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  registerRoutes(server, corsOrigins);

  return server;
}

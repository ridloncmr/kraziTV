import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";

const DEFAULT_CORS_ORIGINS = ["http://127.0.0.1:5173"];

export type BuildServerOptions = FastifyServerOptions & {
  corsOrigins?: string[];
};

export function buildServer(options: BuildServerOptions = {}) {
  const { corsOrigins = DEFAULT_CORS_ORIGINS, ...fastifyOptions } = options;
  const server = Fastify(fastifyOptions);

  void server.register(cors, {
    origin: corsOrigins,
  });

  server.get("/health", async () => ({ status: "ok" }));

  return server;
}

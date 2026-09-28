import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";

export function buildServer(options: FastifyServerOptions = {}) {
  const server = Fastify(options);

  void server.register(cors, {
    origin: true,
  });

  server.get("/health", async () => ({ status: "ok" }));

  return server;
}

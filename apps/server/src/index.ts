import cors from "@fastify/cors";
import Fastify from "fastify";

const server = Fastify({ logger: true });

await server.register(cors, {
  origin: true,
});

server.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await server.listen({ host, port });

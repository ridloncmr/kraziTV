import { buildServer } from "./app.js";
import { isLoopbackHost, parseCorsOrigins } from "./network.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

const server = buildServer({
  logger: true,
  ...(corsOrigins ? { corsOrigins } : {}),
});

if (!isLoopbackHost(host)) {
  server.log.warn(
    "SECURITY WARNING: kraziTV has no authentication. Bind only on a trusted network; connected clients can access mutable administration APIs and local-media scan capabilities.",
  );
}

await server.listen({ host, port });

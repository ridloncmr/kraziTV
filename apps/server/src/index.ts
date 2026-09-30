import { buildServer } from "./app.js";
import { resolveDataDirectory } from "./data-directory.js";
import { openDatabase } from "./database/database.js";
import { isLoopbackHost, parseCorsOrigins } from "./network.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const dataDirectory = resolveDataDirectory(
  process.env.KRAZITV_DATA_DIR,
  process.cwd(),
);
const database = await openDatabase({ dataDirectory });

const server = buildServer(
  { database },
  {
    logger: true,
    ...(corsOrigins ? { corsOrigins } : {}),
  },
);

if (!isLoopbackHost(host)) {
  server.log.warn(
    "SECURITY WARNING: kraziTV has no authentication. Bind only on a trusted network; connected clients can access mutable administration APIs and local-media scan capabilities.",
  );
}

try {
  await server.listen({ host, port });
} catch (error) {
  await server.close();
  throw error;
}

// Closes Fastify, and SQLite through its onClose hook, when the operator stops the process.
function shutdown(): void {
  void server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

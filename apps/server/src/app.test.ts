import { afterEach, describe, expect, it } from "vitest";

import {
  buildServer,
  type ServerDependencies,
  type ServerDatabaseLifecycle,
} from "./app.js";

const servers: ReturnType<typeof buildServer>[] = [];

function createDependencies(
  database: ServerDatabaseLifecycle = { close: async () => undefined },
): ServerDependencies {
  return { database };
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
});

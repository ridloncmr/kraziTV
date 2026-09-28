import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "./app.js";

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("buildServer", () => {
  it("serves the health endpoint through request injection", async () => {
    const server = buildServer({ logger: false });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

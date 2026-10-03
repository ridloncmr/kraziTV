import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createChannel, updateChannel } from "../../testing/api-requests.js";
import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../../testing/test-environment.js";
import { ChannelRepository } from "../repository/channel-repository.js";
import { scriptedClock, sequentialIds } from "../../testing/record-sources.js";

type Server = FastifyInstance;

const LATER = FIXTURE_TIME + 60_000;

afterEach(cleanUpTestEnvironment);

// Boots the real composition with deterministic channel IDs and clock.
async function startServer(
  options: { times?: number[]; dataDirectory?: string } = {},
): Promise<Server> {
  const now = scriptedClock(options.times ?? [FIXTURE_TIME]);
  const { server } = await startTestServer({
    dataDirectory: options.dataDirectory,
    overrides: (db) => ({
      channels: new ChannelRepository(db, {
        createId: sequentialIds("channel"),
        now,
      }),
    }),
  });
  return server;
}

function get(server: Server, url: string) {
  return server.inject({ method: "GET", url });
}

const createdChannel = {
  id: "channel-001",
  number: "69",
  name: "Krazi Comedy",
  enabled: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("POST /channels", () => {
  it("creates a channel with a trimmed name", async () => {
    const server = await startServer();

    const response = await createChannel(server, {
      number: "69",
      name: "  Krazi Comedy  ",
      enabled: true,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(createdChannel);
  });

  it("defaults enabled to true and accepts subchannels", async () => {
    const server = await startServer();

    const response = await createChannel(server, {
      number: "69.1",
      name: "Classics",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ number: "69.1", enabled: true });
  });

  it("creates a disabled channel", async () => {
    const server = await startServer();

    const response = await createChannel(server, {
      number: "69",
      name: "Krazi Comedy",
      enabled: false,
    });

    expect(response.json()).toMatchObject({ enabled: false });
  });

  it.each([
    ["a missing number", { name: "Comedy" }],
    ["a numeric number", { number: 69, name: "Comedy" }],
    ["a leading zero", { number: "069", name: "Comedy" }],
    ["a zero subchannel", { number: "69.0", name: "Comedy" }],
    ["multiple separators", { number: "1.2.3", name: "Comedy" }],
    ["surrounding whitespace", { number: " 69", name: "Comedy" }],
    ["an empty number", { number: "", name: "Comedy" }],
    ["an empty name", { number: "69", name: "" }],
    ["a whitespace-only name", { number: "69", name: "   " }],
    ["a missing name", { number: "69" }],
    ["a non-boolean enabled", { number: "69", name: "Comedy", enabled: "yes" }],
    ["an unknown field", { number: "69", name: "Comedy", collectionId: "x" }],
  ])("rejects %s as invalid_request", async (_label, payload) => {
    const server = await startServer();

    const response = await createChannel(server, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect((await get(server, "/channels")).json()).toEqual([]);
  });

  it("rejects a number held by a disabled channel", async () => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Old", enabled: false });

    const response = await createChannel(server, { number: "69", name: "New" });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: "channel_number_duplicate",
      message: "Channel number 69 is already in use",
    });
  });
});

describe("GET /channels", () => {
  it("returns an empty list before any channel exists", async () => {
    const server = await startServer();

    const response = await get(server, "/channels");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("orders channels numerically by major number, then subchannel", async () => {
    const server = await startServer();
    for (const number of ["11", "10.2", "2", "10", "10.1"]) {
      await createChannel(server, { number, name: `Channel ${number}` });
    }

    const response = await get(server, "/channels");

    expect(
      response.json().map(({ number }: { number: string }) => number),
    ).toEqual(["2", "10", "10.1", "10.2", "11"]);
  });
});

describe("GET /channels/:id", () => {
  it("fetches one channel", async () => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Krazi Comedy" });

    const response = await get(server, "/channels/channel-001");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(createdChannel);
  });

  it("reports an unknown channel", async () => {
    const server = await startServer();

    const response = await get(server, "/channels/missing");

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({
      code: "channel_not_found",
      message: "Channel missing does not exist",
    });
  });
});

describe("PATCH /channels/:id", () => {
  it("changes only the given fields and advances updatedAt", async () => {
    const server = await startServer({ times: [FIXTURE_TIME, LATER] });
    await createChannel(server, { number: "69", name: "Krazi Comedy" });

    const response = await updateChannel(server, "channel-001", {
      enabled: false,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...createdChannel,
      enabled: false,
      updatedAt: new Date(LATER).toISOString(),
    });
  });

  it("renumbers and renames with a trimmed name", async () => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Krazi Comedy" });

    const response = await updateChannel(server, "channel-001", {
      number: "69.1",
      name: "  Krazi Classics ",
    });

    expect(response.json()).toMatchObject({
      number: "69.1",
      name: "Krazi Classics",
    });
  });

  it.each([
    ["an empty body", {}],
    ["a malformed number", { number: "069" }],
    ["an empty name", { name: " " }],
    ["a null enabled", { enabled: null }],
    ["an unknown field", { collectionId: "x" }],
  ])("rejects %s as invalid_request", async (_label, payload) => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Krazi Comedy" });

    const response = await updateChannel(server, "channel-001", payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect((await get(server, "/channels/channel-001")).json()).toEqual(
      createdChannel,
    );
  });

  it("rejects another channel's number, including a disabled one", async () => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Old", enabled: false });
    await createChannel(server, { number: "70", name: "New" });

    const response = await updateChannel(server, "channel-002", {
      number: "69",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: "channel_number_duplicate",
      message: "Channel number 69 is already in use",
    });
    expect((await get(server, "/channels/channel-002")).json()).toMatchObject({
      number: "70",
    });
  });

  it("reports an unknown channel", async () => {
    const server = await startServer();

    const response = await updateChannel(server, "missing", {
      name: "Anything",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("channel_not_found");
  });
});

describe("DELETE /channels/:id", () => {
  it("deletes a channel and succeeds again when it is already gone", async () => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Krazi Comedy" });

    const first = await server.inject({
      method: "DELETE",
      url: "/channels/channel-001",
    });
    const repeated = await server.inject({
      method: "DELETE",
      url: "/channels/channel-001",
    });

    expect(first.statusCode).toBe(204);
    expect(repeated.statusCode).toBe(204);
    expect((await get(server, "/channels/channel-001")).statusCode).toBe(404);
  });

  it("frees the deleted channel's number", async () => {
    const server = await startServer();
    await createChannel(server, { number: "69", name: "Old" });
    await server.inject({ method: "DELETE", url: "/channels/channel-001" });

    const response = await createChannel(server, { number: "69", name: "New" });

    expect(response.statusCode).toBe(201);
  });
});

describe("channel persistence", () => {
  it("keeps channels across a server restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startServer({ dataDirectory });
    await createChannel(first, { number: "69", name: "Krazi Comedy" });
    await first.close();

    const restarted = await startServer({ dataDirectory });

    expect((await get(restarted, "/channels")).json()).toEqual([
      createdChannel,
    ]);
  });
});

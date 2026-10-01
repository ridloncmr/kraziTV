import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";
import { MediaRootRepository } from "./media-root-repository.js";
import { sequentialIds } from "../testing/record-sources.js";

type Server = FastifyInstance;

afterEach(cleanUpTestEnvironment);

// Boots the real composition with a deterministic clock and ID sequence.
async function startServer(dataDirectory?: string): Promise<Server> {
  let now = FIXTURE_TIME;
  const { server } = await startTestServer({
    dataDirectory,
    overrides: (db) => {
      const mediaRoots = new MediaRootRepository(db, {
        createId: sequentialIds("root"),
        now: () => (now += 1_000),
      });
      return { mediaRoots };
    },
  });
  return server;
}

// A syntactically absolute path on the host platform that never exists on disk.
function missingPath(...segments: string[]): string {
  return join(tmpdir(), "krazitv-never-created", ...segments);
}

async function createRoot(server: Server, payload: InjectOptions["payload"]) {
  return server.inject({ method: "POST", url: "/media-roots", payload });
}

describe("POST /media-roots", () => {
  it("creates an enabled root at a missing path without touching the filesystem", async () => {
    const server = await startServer();
    const path = missingPath("TV");

    const response = await createRoot(server, { path });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: "root-001",
      path,
      enabled: true,
      createdAt: "2024-01-01T00:00:01.000Z",
      updatedAt: "2024-01-01T00:00:01.000Z",
      lastScannedAt: null,
    });
  });

  it("returns the normalized display path", async () => {
    const server = await startServer();

    const response = await createRoot(server, {
      path: `${missingPath("Shows", "..", "Movies")}${sep}`,
    });

    expect(response.json().path).toBe(missingPath("Movies"));
  });

  it("can create a root that starts disabled", async () => {
    const server = await startServer();

    const response = await createRoot(server, {
      path: missingPath("TV"),
      enabled: false,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().enabled).toBe(false);
  });

  it("rejects a relative path", async () => {
    const server = await startServer();

    const response = await createRoot(server, { path: join("media", "TV") });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "invalid_request", message: expect.any(String) },
    });
  });

  it.each([
    ["a missing body", undefined],
    ["a non-string path", { path: 42 }],
    ["an unknown field", { path: missingPath("TV"), label: "TV" }],
  ])("rejects %s", async (_label, payload) => {
    const server = await startServer();

    const response = await createRoot(server, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("rejects malformed JSON with the structured error shape", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "POST",
      url: "/media-roots",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("rejects a path whose normalized identity already exists", async () => {
    const server = await startServer();
    await createRoot(server, { path: missingPath("TV") });

    const response = await createRoot(server, {
      path: `${missingPath("Shows", "..", "TV")}${sep}`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: "media_root_duplicate", message: expect.any(String) },
    });
  });
});

describe("GET /media-roots", () => {
  it("lists roots in normalized path order", async () => {
    const server = await startServer();
    await createRoot(server, { path: missingPath("TV") });
    await createRoot(server, { path: missingPath("Movies") });

    const response = await server.inject({
      method: "GET",
      url: "/media-roots",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ path }: { path: string }) => path)).toEqual([
      missingPath("Movies"),
      missingPath("TV"),
    ]);
  });

  it("returns an empty list before any root is configured", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "GET",
      url: "/media-roots",
    });

    expect(response.json()).toEqual([]);
  });
});

describe("PATCH /media-roots/:id", () => {
  it("disables and re-enables a root", async () => {
    const server = await startServer();
    await createRoot(server, { path: missingPath("TV") });

    const disabled = await server.inject({
      method: "PATCH",
      url: "/media-roots/root-001",
      payload: { enabled: false },
    });
    const enabled = await server.inject({
      method: "PATCH",
      url: "/media-roots/root-001",
      payload: { enabled: true },
    });

    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({
      id: "root-001",
      enabled: false,
      createdAt: "2024-01-01T00:00:01.000Z",
      updatedAt: "2024-01-01T00:00:02.000Z",
    });
    expect(enabled.json()).toMatchObject({
      enabled: true,
      updatedAt: "2024-01-01T00:00:03.000Z",
    });
  });

  it("rejects an attempt to change the path", async () => {
    const server = await startServer();
    await createRoot(server, { path: missingPath("TV") });

    const response = await server.inject({
      method: "PATCH",
      url: "/media-roots/root-001",
      payload: { path: missingPath("Movies"), enabled: false },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("media_root_path_immutable");
    const list = await server.inject({ method: "GET", url: "/media-roots" });
    expect(list.json()).toMatchObject([
      { path: missingPath("TV"), enabled: true },
    ]);
  });

  it.each([
    ["an empty body", {}],
    ["a non-boolean flag", { enabled: "no" }],
    ["an unknown field", { enabled: false, label: "TV" }],
  ])("rejects %s", async (_label, payload) => {
    const server = await startServer();
    await createRoot(server, { path: missingPath("TV") });

    const response = await server.inject({
      method: "PATCH",
      url: "/media-roots/root-001",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("reports an unknown root", async () => {
    const server = await startServer();

    const response = await server.inject({
      method: "PATCH",
      url: "/media-roots/root-404",
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "media_root_not_found", message: expect.any(String) },
    });
  });
});

describe("media root persistence", () => {
  it("keeps roots, including missing ones, across a server and database restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startServer(dataDirectory);
    await createRoot(first, { path: missingPath("TV"), enabled: false });
    const created = await first.inject({ method: "GET", url: "/media-roots" });
    await first.close();

    const second = await startServer(dataDirectory);
    await second.ready();
    const reopened = await second.inject({
      method: "GET",
      url: "/media-roots",
    });

    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual(created.json());
  });
});

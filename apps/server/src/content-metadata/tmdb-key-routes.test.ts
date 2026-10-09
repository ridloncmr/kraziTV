import { TmdbClient } from "@krazitv/media";
import { afterEach, describe, expect, it } from "vitest";

import { send } from "../testing/api-requests.js";
import { captureLogLines } from "../testing/captured-log-lines.js";
import { ScriptedTmdbFetch } from "../testing/scripted-tmdb-fetch.js";
import { createBarrier } from "../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import { TmdbKeyService } from "./tmdb-key-service.js";

afterEach(cleanUpTestEnvironment);

const GOOD_KEY = "eyJ.good-read-access-token.sig";
const BAD_KEY = "eyJ.revoked-token.sig";
// A token pasted with a wrapped line: fetch's error for it would quote it.
const BROKEN_KEY = "eyJ.wrapped\ntoken.sig";

/**
 * Starts a server whose TMDB key service calls a scripted TMDB that accepts
 * only GOOD_KEY, logging every line at trace level into `lines`.
 */
async function startWithTmdb() {
  const tmdb = new ScriptedTmdbFetch();
  tmdb.validKeys.add(GOOD_KEY);
  const { lines, stream } = captureLogLines();
  const { server, db } = await startTestServer({
    logger: { level: "trace", stream },
    overrides: (database) => ({
      tmdbKeys: new TmdbKeyService(
        database,
        new TmdbClient({ fetch: tmdb.fetch, timeoutMs: 1_000 }),
      ),
    }),
  });
  /** Reads the stored key straight from SQLite, bypassing every route. */
  const storedKey = async () =>
    (
      await db
        .selectFrom("server_settings")
        .select("tmdb_api_key")
        .executeTakeFirstOrThrow()
    ).tmdb_api_key;
  return { server, tmdb, lines, storedKey };
}

describe("TMDB key routes", () => {
  it.each(["DELETE", "PUT"] as const)(
    "a delayed save cannot undo a later %s",
    async (method) => {
      const { server, tmdb, storedKey } = await startWithTmdb();
      const replacement = "eyJ.replacement-token.sig";
      tmdb.validKeys.add(replacement);
      const barrier = createBarrier();
      tmdb.nextCallBarrier = barrier;
      const pending = send(server, "PUT", "/metadata/tmdb-key", {
        apiKey: GOOD_KEY,
      });
      await barrier.reached;
      try {
        const response = await send(
          server,
          method,
          "/metadata/tmdb-key",
          method === "PUT" ? { apiKey: replacement } : undefined,
        );
        expect(response.status).toBe(200);
      } finally {
        barrier.release();
      }
      expect(await pending).toMatchObject({
        status: 409,
        body: { error: { code: "tmdb_key_changed" } },
      });
      await expect(storedKey()).resolves.toBe(
        method === "PUT" ? replacement : null,
      );
    },
  );

  it("reports no key before one is saved", async () => {
    const { server } = await startWithTmdb();

    await expect(send(server, "GET", "/metadata/tmdb-key")).resolves.toEqual({
      status: 200,
      body: { configured: false },
    });
  });

  it("validates a key with TMDB, stores it, and reports it configured without returning it", async () => {
    const { server, tmdb, storedKey } = await startWithTmdb();

    await expect(
      send(server, "PUT", "/metadata/tmdb-key", { apiKey: ` ${GOOD_KEY} ` }),
    ).resolves.toEqual({ status: 200, body: { configured: true } });
    await expect(send(server, "GET", "/metadata/tmdb-key")).resolves.toEqual({
      status: 200,
      body: { configured: true },
    });
    expect(tmdb.tokens).toEqual([GOOD_KEY]);
    await expect(storedKey()).resolves.toBe(GOOD_KEY);
  });

  it("refuses a key TMDB rejects and keeps the key already saved", async () => {
    const { server, storedKey } = await startWithTmdb();
    await send(server, "PUT", "/metadata/tmdb-key", { apiKey: GOOD_KEY });

    const response = await send(server, "PUT", "/metadata/tmdb-key", {
      apiKey: BAD_KEY,
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_tmdb_key" } },
    });
    await expect(storedKey()).resolves.toBe(GOOD_KEY);
  });

  it("refuses a token that cannot be sent as invalid_tmdb_key without calling TMDB", async () => {
    const { server, tmdb, storedKey } = await startWithTmdb();

    const response = await send(server, "PUT", "/metadata/tmdb-key", {
      apiKey: BROKEN_KEY,
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_tmdb_key" } },
    });
    expect(tmdb.tokens).toEqual([]);
    await expect(storedKey()).resolves.toBeNull();
  });

  it("answers 502 when TMDB is unreachable and stores nothing", async () => {
    const { server, tmdb, storedKey } = await startWithTmdb();
    tmdb.unreachable = true;

    const response = await send(server, "PUT", "/metadata/tmdb-key", {
      apiKey: GOOD_KEY,
    });

    expect(response).toMatchObject({
      status: 502,
      body: { error: { code: "tmdb_unreachable" } },
    });
    await expect(storedKey()).resolves.toBeNull();
  });

  it.each([
    ["a blank key", { apiKey: "   " }],
    ["a missing key", {}],
    ["an unknown field", { apiKey: GOOD_KEY, account: "x" }],
  ])("refuses %s as invalid_request without calling TMDB", async (_, body) => {
    const { server, tmdb, storedKey } = await startWithTmdb();

    const response = await send(server, "PUT", "/metadata/tmdb-key", body);

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    expect(tmdb.tokens).toEqual([]);
    await expect(storedKey()).resolves.toBeNull();
  });

  it("removes the saved key", async () => {
    const { server, storedKey } = await startWithTmdb();
    await send(server, "PUT", "/metadata/tmdb-key", { apiKey: GOOD_KEY });

    await expect(send(server, "DELETE", "/metadata/tmdb-key")).resolves.toEqual(
      { status: 200, body: { configured: false } },
    );
    await expect(send(server, "GET", "/metadata/tmdb-key")).resolves.toEqual({
      status: 200,
      body: { configured: false },
    });
    await expect(storedKey()).resolves.toBeNull();
  });

  it("never writes a key into a response or log line, whatever TMDB answers", async () => {
    const { server, tmdb, lines } = await startWithTmdb();
    const bodies = [
      await send(server, "PUT", "/metadata/tmdb-key", { apiKey: GOOD_KEY }),
      await send(server, "GET", "/metadata/tmdb-key"),
      await send(server, "PUT", "/metadata/tmdb-key", { apiKey: BAD_KEY }),
      await send(server, "PUT", "/metadata/tmdb-key", { apiKey: BROKEN_KEY }),
    ];
    tmdb.unreachable = true;
    bodies.push(
      await send(server, "PUT", "/metadata/tmdb-key", { apiKey: GOOD_KEY }),
      await send(server, "DELETE", "/metadata/tmdb-key"),
    );

    expect(lines.length).toBeGreaterThan(0);
    const written = JSON.stringify([bodies, lines]);
    expect(written).not.toContain(GOOD_KEY);
    expect(written).not.toContain(BAD_KEY);
    expect(written).not.toContain(JSON.stringify(BROKEN_KEY).slice(1, -1));
    // The outage is still logged, so an operator can see why the save failed.
    expect(lines).toContainEqual(
      expect.objectContaining({ reason: "TMDB request failed" }),
    );
  });
});

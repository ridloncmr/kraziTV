import type { FastifyServerOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { send, signIn } from "../../testing/api-requests.js";
import { captureLogLines } from "../../testing/captured-log-lines.js";
import { holdWriteAuthority } from "../../testing/hold-write-authority.js";
import { manualClock } from "../../testing/manual-clock.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
  startTestServer,
} from "../../testing/test-environment.js";
import { AuthService } from "../auth-service.js";

afterEach(cleanUpTestEnvironment);

const START = 1_700_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Starts a really gated server whose auth clock the test steps. */
async function startClockedServer(
  options: {
    dataDirectory?: string;
    publicBaseUrl?: string;
    at?: number;
    logger?: FastifyServerOptions["logger"];
  } = {},
) {
  const clock = manualClock(options.at ?? START);
  const started = await startTestServer({
    auth: "real",
    dataDirectory: options.dataDirectory,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.publicBaseUrl === undefined
      ? {}
      : { plex: { publicBaseUrl: options.publicBaseUrl } }),
    overrides: (db) => ({ auth: new AuthService(db, { now: clock.now }) }),
  });
  return { ...started, clock };
}

/** Reads every session's expiry, oldest first. */
async function readExpiry(
  db: Awaited<ReturnType<typeof startTestServer>>["db"],
): Promise<number[]> {
  const rows = await db
    .selectFrom("sessions")
    .select("expires_at")
    .orderBy("expires_at")
    .execute();
  return rows.map((row) => row.expires_at);
}

describe("sliding session expiry", () => {
  it("neither reissues the cookie nor writes 12 hours after login", async () => {
    const { server, db, clock } = await startClockedServer();
    const { cookie } = await signIn(server);
    clock.advance(12 * HOUR_MS);

    const response = await server.inject({
      method: "GET",
      url: "/channels",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await expect(readExpiry(db)).resolves.toEqual([START + 30 * DAY_MS]);
  });

  it("reissues the same cookie and moves the expiry 25 hours after login", async () => {
    const { server, db, clock } = await startClockedServer();
    const { cookie } = await signIn(server);
    clock.advance(25 * HOUR_MS);

    const response = await server.inject({
      method: "GET",
      url: "/channels",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBe(
      `${cookie}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict`,
    );
    await expect(readExpiry(db)).resolves.toEqual([
      START + 25 * HOUR_MS + 30 * DAY_MS,
    ]);
  });

  it("marks a reissued cookie Secure when the public base URL is https", async () => {
    const { server, clock } = await startClockedServer({
      publicBaseUrl: "https://krazitv.test",
    });
    const { cookie } = await signIn(server);
    clock.advance(25 * HOUR_MS);

    const response = await server.inject({
      method: "GET",
      url: "/channels",
      headers: { cookie },
    });

    expect(response.headers["set-cookie"]).toMatch(/; Secure$/);
  });

  it("answers a due renewal that cannot write as signed in, without a cookie, and warns", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const { lines, stream } = captureLogLines();
    const { server, db, clock } = await startClockedServer({
      dataDirectory,
      logger: { level: "warn", stream },
    });
    const { cookie } = await signIn(server);
    clock.advance(25 * HOUR_MS);
    // Another process, such as the reset-password command, holds the lock.
    const other = await openTestDatabase(dataDirectory);
    const held = await holdWriteAuthority(other.db);

    let response;
    try {
      response = await server.inject({
        method: "GET",
        url: "/channels",
        headers: { cookie },
      });
    } finally {
      await held.release();
    }

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 40, msg: "Renewing a session failed" }),
    );
    await expect(readExpiry(db)).resolves.toEqual([START + 30 * DAY_MS]);

    // The next request after the lock clears renews as usual.
    await expect(
      server.inject({ method: "GET", url: "/channels", headers: { cookie } }),
    ).resolves.toMatchObject({
      statusCode: 200,
      headers: { "set-cookie": expect.any(String) },
    });
  });

  it("answers a session idle for 30 days 401 and deletes its row", async () => {
    const { server, db, clock } = await startClockedServer();
    const { cookie } = await signIn(server);
    clock.advance(30 * DAY_MS);

    await expect(
      send(server, "GET", "/channels", undefined, { cookie }),
    ).resolves.toMatchObject({
      status: 401,
      body: { error: { code: "unauthenticated" } },
    });
    await expect(readExpiry(db)).resolves.toEqual([]);
  });

  it("deletes expired sessions when the server restarts", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startClockedServer({ dataDirectory });
    await signIn(first.server);
    first.clock.advance(20 * DAY_MS);
    const live = await first.server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password: "correct horse" },
    });
    expect(live.statusCode).toBe(200);
    await first.server.close();

    const restarted = await startClockedServer({
      dataDirectory,
      at: START + 31 * DAY_MS,
    });
    await restarted.server.ready();

    await expect(readExpiry(restarted.db)).resolves.toEqual([
      START + 50 * DAY_MS,
    ]);
  });
});

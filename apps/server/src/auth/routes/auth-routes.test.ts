import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import { manualClock } from "../../testing/manual-clock.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import { AuthService } from "../auth-service.js";
import { DEFAULT_AVATAR_ID } from "../avatars.js";

afterEach(cleanUpTestEnvironment);

const owner = { displayName: "  Owner  ", password: "correct horse" };
const SESSION_COOKIE =
  /^krazitv_session=([A-Za-z0-9_-]{43}); Path=\/; Max-Age=2592000; HttpOnly; SameSite=Strict$/;

/** Sets up the owner and returns the raw response, for header assertions. */
function setUp(server: FastifyInstance, payload: unknown = owner) {
  return server.inject({
    method: "POST",
    url: "/auth/setup",
    payload: payload as object,
  });
}

/** Reads auth state the way a browser holding `cookie` would. */
async function readState(server: FastifyInstance, cookie?: string) {
  const response = await server.inject({
    method: "GET",
    url: "/auth/state",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
  return { status: response.statusCode, body: response.json<unknown>() };
}

/** Returns the `name=value` pair a browser would send back from a `Set-Cookie` response. */
function cookieOf(response: { headers: Record<string, unknown> }): string {
  return String(response.headers["set-cookie"]).split(";")[0];
}

/** Logs in and returns the raw response, for header assertions. */
function logIn(server: FastifyInstance, password: unknown) {
  return server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { password } as object,
  });
}

/** Logs out the way a browser holding `cookie` would. */
function logOut(server: FastifyInstance, cookie?: string) {
  return server.inject({
    method: "POST",
    url: "/auth/logout",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

/** Counts rows so refusals can prove they wrote nothing. */
async function countRows(
  db: Awaited<ReturnType<typeof startTestServer>>["db"],
) {
  const accounts = await db.selectFrom("accounts").select("id").execute();
  const sessions = await db.selectFrom("sessions").select("id").execute();
  return { accounts: accounts.length, sessions: sessions.length };
}

describe("auth routes", () => {
  it("reports that a fresh server needs setup", async () => {
    const { server } = await startTestServer();

    await expect(readState(server)).resolves.toEqual({
      status: 200,
      body: { setupRequired: true, account: null, authenticated: false },
    });
  });

  it("sets up the account with a trimmed name and answers with the session cookie", async () => {
    const { server } = await startTestServer();

    const response = await setUp(server);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      setupRequired: false,
      account: { displayName: "Owner", avatarId: DEFAULT_AVATAR_ID },
      authenticated: true,
    });
    expect(response.headers["set-cookie"]).toMatch(SESSION_COOKIE);
  });

  it("recognizes the setup cookie on later state reads", async () => {
    const { server } = await startTestServer();
    const cookie = cookieOf(await setUp(server));

    await expect(readState(server, `theme=xp; ${cookie}`)).resolves.toEqual({
      status: 200,
      body: {
        setupRequired: false,
        account: { displayName: "Owner", avatarId: DEFAULT_AVATAR_ID },
        authenticated: true,
      },
    });
    await expect(readState(server)).resolves.toMatchObject({
      body: { setupRequired: false, authenticated: false },
    });
  });

  it("marks the cookie Secure when the public base URL is https", async () => {
    const { server } = await startTestServer({
      plex: { publicBaseUrl: "https://krazitv.test" },
    });

    const response = await setUp(server);

    expect(response.headers["set-cookie"]).toMatch(/; Secure$/);
  });

  it("refuses a second setup and leaves one account", async () => {
    const { server, db } = await startTestServer();
    await setUp(server);

    const second = await setUp(server, {
      displayName: "Intruder",
      password: "another one",
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: "already_set_up" } });
    expect(second.headers["set-cookie"]).toBeUndefined();
    await expect(countRows(db)).resolves.toEqual({ accounts: 1, sessions: 1 });
  });

  it("creates exactly one account from two concurrent setups", async () => {
    const { server, db } = await startTestServer();

    const responses = await Promise.all([setUp(server), setUp(server)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    await expect(countRows(db)).resolves.toEqual({ accounts: 1, sessions: 1 });
  });

  it.each([
    ["a blank name", { displayName: "   ", password: "correct horse" }],
    [
      "a 41-character name",
      { displayName: "n".repeat(41), password: "pw-long-enough" },
    ],
    ["a 7-character password", { displayName: "Owner", password: "1234567" }],
    [
      "a 257-character password",
      { displayName: "Owner", password: "p".repeat(257) },
    ],
    ["a missing password", { displayName: "Owner" }],
    ["an unknown field", { ...owner, avatarId: "duck" }],
  ])("refuses %s without writing", async (_, payload) => {
    const { server, db } = await startTestServer();

    const response = await send(server, "POST", "/auth/setup", payload);

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(countRows(db)).resolves.toEqual({ accounts: 0, sessions: 0 });
  });

  it.each([
    [
      "a 40-character name",
      { displayName: "n".repeat(40), password: "12345678" },
    ],
    [
      "a 256-character password",
      { displayName: "Owner", password: "p".repeat(256) },
    ],
  ])("accepts %s", async (_, payload) => {
    const { server } = await startTestServer();

    await expect(setUp(server, payload)).resolves.toMatchObject({
      statusCode: 201,
    });
  });
});

describe("login and logout", () => {
  it("refuses login before setup", async () => {
    const { server, db } = await startTestServer();

    const response = await logIn(server, owner.password);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "setup_required" },
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    await expect(countRows(db)).resolves.toEqual({ accounts: 0, sessions: 0 });
  });

  it("refuses a wrong password and sets no cookie", async () => {
    const { server, db } = await startTestServer();
    await setUp(server);

    const response = await logIn(server, "correct horsf");

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_password" },
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    await expect(countRows(db)).resolves.toEqual({ accounts: 1, sessions: 1 });
  });

  it.each([
    ["a missing password", {}],
    ["a non-string password", { password: 12345678 }],
    ["a 257-character password", { password: "p".repeat(257) }],
    ["an unknown field", { password: "correct horse", displayName: "Owner" }],
  ])("refuses %s as an invalid request", async (_, payload) => {
    const { server } = await startTestServer();
    await setUp(server);

    await expect(
      send(server, "POST", "/auth/login", payload),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("logs in with the right password and sets a cookie state accepts", async () => {
    const { server } = await startTestServer();
    await setUp(server);

    const response = await logIn(server, owner.password);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      setupRequired: false,
      account: { displayName: "Owner", avatarId: DEFAULT_AVATAR_ID },
      authenticated: true,
    });
    expect(response.headers["set-cookie"]).toMatch(SESSION_COOKIE);
    await expect(readState(server, cookieOf(response))).resolves.toMatchObject({
      body: { authenticated: true },
    });
  });

  it("logs out only the browser that asks, and clears its cookie", async () => {
    const { server, db } = await startTestServer();
    const firstBrowser = cookieOf(await setUp(server));
    const secondBrowser = cookieOf(await logIn(server, owner.password));

    const response = await logOut(server, firstBrowser);

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toBe(
      "krazitv_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
    );
    await expect(readState(server, firstBrowser)).resolves.toMatchObject({
      body: { authenticated: false },
    });
    await expect(readState(server, secondBrowser)).resolves.toMatchObject({
      body: { authenticated: true },
    });
    await expect(countRows(db)).resolves.toEqual({ accounts: 1, sessions: 1 });
  });

  it("clears a Secure cookie with the same attributes over https", async () => {
    const { server } = await startTestServer({
      plex: { publicBaseUrl: "https://krazitv.test" },
    });

    const response = await logOut(server);

    expect(response.headers["set-cookie"]).toBe(
      "krazitv_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure",
    );
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown session", "krazitv_session=not-a-session"],
  ])("answers logout with %s as success", async (_, cookie) => {
    const { server, db } = await startTestServer();
    await setUp(server);

    const response = await logOut(server, cookie);

    expect(response.statusCode).toBe(204);
    await expect(countRows(db)).resolves.toEqual({ accounts: 1, sessions: 1 });
  });
});

describe("login throttling", () => {
  /** Starts a set-up server whose auth clock the test steps. */
  async function startThrottledServer() {
    const clock = manualClock(1_700_000_000_000);
    const { server } = await startTestServer({
      overrides: (db) => ({ auth: new AuthService(db, { now: clock.now }) }),
    });
    await setUp(server);
    return { server, clock };
  }

  it("answers the sixth attempt after five wrong passwords with 429, even with the right password", async () => {
    const { server } = await startThrottledServer();
    for (let i = 0; i < 5; i += 1) {
      expect((await logIn(server, "wrong password")).statusCode).toBe(401);
    }

    const response = await logIn(server, owner.password);

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json()).toEqual({
      error: {
        code: "too_many_attempts",
        message: expect.any(String),
        retryAfterSeconds: 1,
      },
    });
  });

  it("doubles the wait after a wrong password once the wait has passed", async () => {
    const { server, clock } = await startThrottledServer();
    for (let i = 0; i < 5; i += 1) await logIn(server, "wrong password");
    clock.advance(1000);

    expect((await logIn(server, "wrong password")).statusCode).toBe(401);

    await expect(logIn(server, "wrong password")).resolves.toMatchObject({
      statusCode: 429,
      headers: { "retry-after": "2" },
    });
  });

  it("logs in with the right password after the wait", async () => {
    const { server, clock } = await startThrottledServer();
    for (let i = 0; i < 5; i += 1) await logIn(server, "wrong password");
    clock.advance(1000);

    const response = await logIn(server, owner.password);

    expect(response.statusCode).toBe(200);
    await expect(readState(server, cookieOf(response))).resolves.toMatchObject({
      body: { authenticated: true },
    });
  });
});

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
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
    const setCookie = String((await setUp(server)).headers["set-cookie"]);
    const cookie = setCookie.split(";")[0];

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

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  cookieOf,
  logIn,
  send,
  SIGN_IN_PASSWORD,
  signIn,
} from "../../testing/api-requests.js";
import { manualClock } from "../../testing/manual-clock.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import { AuthService } from "../auth-service.js";
import { DEFAULT_AVATAR_ID } from "../avatars.js";

afterEach(cleanUpTestEnvironment);

/** Starts a really gated server with the owner logged in. */
async function startSignedIn() {
  const { server } = await startTestServer({ auth: "real" });
  const { cookie } = await signIn(server);
  return { server, cookie };
}

/** Patches the account the way a browser holding `cookie` would. */
function patchAccount(
  server: FastifyInstance,
  payload: object,
  cookie?: string,
) {
  return send(
    server,
    "PATCH",
    "/account",
    payload,
    cookie === undefined ? {} : { cookie },
  );
}

/** Changes the password the way a browser holding `cookie` would. */
function changePassword(
  server: FastifyInstance,
  payload: object,
  cookie: string,
) {
  return send(server, "PUT", "/account/password", payload, { cookie });
}

/** Reads the account profile `GET /auth/state` reports. */
async function readProfile(server: FastifyInstance) {
  const { body } = await send(server, "GET", "/auth/state");
  return (body as { account: unknown }).account;
}

describe("account routes", () => {
  it("changes the display name, trimmed, and auth state reports it", async () => {
    const { server, cookie } = await startSignedIn();

    await expect(
      patchAccount(server, { displayName: "  Channel Boss  " }, cookie),
    ).resolves.toEqual({
      status: 200,
      body: { displayName: "Channel Boss", avatarId: DEFAULT_AVATAR_ID },
    });
    await expect(readProfile(server)).resolves.toEqual({
      displayName: "Channel Boss",
      avatarId: DEFAULT_AVATAR_ID,
    });
  });

  it("changes the avatar and auth state reports it", async () => {
    const { server, cookie } = await startSignedIn();

    await expect(
      patchAccount(server, { avatarId: "chess" }, cookie),
    ).resolves.toEqual({
      status: 200,
      body: { displayName: "Owner", avatarId: "chess" },
    });
    await expect(readProfile(server)).resolves.toEqual({
      displayName: "Owner",
      avatarId: "chess",
    });
  });

  it("refuses an unknown avatar and changes nothing, not even the name beside it", async () => {
    const { server, cookie } = await startSignedIn();

    const response = await patchAccount(
      server,
      { displayName: "Renamed", avatarId: "pizza" },
      cookie,
    );

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "unknown_avatar" } },
    });
    await expect(readProfile(server)).resolves.toEqual({
      displayName: "Owner",
      avatarId: DEFAULT_AVATAR_ID,
    });
  });

  it.each([
    ["a 41-character name", { displayName: "n".repeat(41) }],
    ["a blank name", { displayName: "   " }],
    ["an unknown field", { avatarId: "chess", theme: "luna" }],
    ["an empty body", {}],
  ])("refuses %s as invalid_request and changes nothing", async (_, body) => {
    const { server, cookie } = await startSignedIn();

    const response = await patchAccount(server, body, cookie);

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(readProfile(server)).resolves.toEqual({
      displayName: "Owner",
      avatarId: DEFAULT_AVATAR_ID,
    });
  });

  it("accepts a 40-character name", async () => {
    const { server, cookie } = await startSignedIn();

    const response = await patchAccount(
      server,
      { displayName: "n".repeat(40) },
      cookie,
    );

    expect(response.status).toBe(200);
  });

  it("answers 401 without a session and changes nothing", async () => {
    const { server } = await startSignedIn();

    const response = await patchAccount(server, { displayName: "Intruder" });

    expect(response).toMatchObject({
      status: 401,
      body: { error: { code: "unauthenticated" } },
    });
    await expect(readProfile(server)).resolves.toMatchObject({
      displayName: "Owner",
    });
  });
});

describe("password change route", () => {
  const NEW_PASSWORD = "battery staple";

  it("replaces the password, keeps the changing session, and ends every other", async () => {
    const { server, cookie } = await startSignedIn();
    const other = cookieOf(await logIn(server, SIGN_IN_PASSWORD));

    await expect(
      changePassword(
        server,
        { currentPassword: SIGN_IN_PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      ),
    ).resolves.toEqual({ status: 204, body: undefined });

    await expect(
      send(server, "GET", "/channels", undefined, { cookie }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      send(server, "GET", "/channels", undefined, { cookie: other }),
    ).resolves.toMatchObject({ status: 401 });
    expect((await logIn(server, NEW_PASSWORD)).statusCode).toBe(200);
    expect((await logIn(server, SIGN_IN_PASSWORD)).json()).toMatchObject({
      error: { code: "invalid_password" },
    });
  });

  it("refuses a wrong current password with 400 and keeps the old password", async () => {
    const { server, cookie } = await startSignedIn();

    const response = await changePassword(
      server,
      { currentPassword: "wrong password", newPassword: NEW_PASSWORD },
      cookie,
    );

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_password" } },
    });
    expect((await logIn(server, SIGN_IN_PASSWORD)).statusCode).toBe(200);
    expect((await logIn(server, NEW_PASSWORD)).statusCode).toBe(401);
  });

  it.each([
    [
      "a short new password",
      { currentPassword: SIGN_IN_PASSWORD, newPassword: "short" },
    ],
    ["a missing current password", { newPassword: NEW_PASSWORD }],
    [
      "an unknown field",
      {
        currentPassword: SIGN_IN_PASSWORD,
        newPassword: NEW_PASSWORD,
        hint: "x",
      },
    ],
  ])(
    "refuses %s as invalid_request and keeps the old password",
    async (_, body) => {
      const { server, cookie } = await startSignedIn();

      await expect(changePassword(server, body, cookie)).resolves.toMatchObject(
        {
          status: 400,
          body: { error: { code: "invalid_request" } },
        },
      );
      expect((await logIn(server, SIGN_IN_PASSWORD)).statusCode).toBe(200);
    },
  );

  it("throttles wrong current passwords like logins, and a success forgives them", async () => {
    const clock = manualClock(1_700_000_000_000);
    const { server } = await startTestServer({
      auth: "real",
      overrides: (db) => ({ auth: new AuthService(db, { now: clock.now }) }),
    });
    const { cookie } = await signIn(server);
    const wrong = {
      currentPassword: "wrong password",
      newPassword: NEW_PASSWORD,
    };
    for (let i = 0; i < 5; i += 1) {
      expect((await changePassword(server, wrong, cookie)).status).toBe(400);
    }

    const throttled = await server.inject({
      method: "PUT",
      url: "/account/password",
      payload: { currentPassword: SIGN_IN_PASSWORD, newPassword: NEW_PASSWORD },
      headers: { cookie },
    });

    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("1");
    expect(throttled.json()).toEqual({
      error: {
        code: "too_many_attempts",
        message: expect.any(String),
        retryAfterSeconds: 1,
      },
    });
    expect((await logIn(server, NEW_PASSWORD)).statusCode).toBe(429);

    clock.advance(1000);
    await expect(
      changePassword(
        server,
        { currentPassword: SIGN_IN_PASSWORD, newPassword: NEW_PASSWORD },
        cookie,
      ),
    ).resolves.toMatchObject({ status: 204 });
    for (let i = 0; i < 5; i += 1) {
      expect((await logIn(server, "wrong password")).statusCode).toBe(401);
    }
  });
});

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { send, signIn } from "../../testing/api-requests.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
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

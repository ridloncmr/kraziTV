import { afterEach, describe, expect, it } from "vitest";

import { send, signIn } from "../../testing/api-requests.js";
import { plexSettingsFixture } from "../../testing/plex-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const WEB_ORIGIN = "http://127.0.0.1:5173";
const EVIL_ORIGIN = "http://evil.example";
const channel = { number: "7", name: "Seven" };

/** Starts a really gated, set-up server and returns its admin cookie. */
async function startSignedInServer() {
  const started = await startTestServer({ auth: "real" });
  const { cookie } = await signIn(started.server);
  return { ...started, cookie };
}

/** Counts rows so refusals can prove they wrote nothing. */
async function countRows(
  db: Awaited<ReturnType<typeof startTestServer>>["db"],
) {
  const [channels, accounts, sessions] = await Promise.all([
    db.selectFrom("channels").select("id").execute(),
    db.selectFrom("accounts").select("id").execute(),
    db.selectFrom("sessions").select("id").execute(),
  ]);
  return {
    channels: channels.length,
    accounts: accounts.length,
    sessions: sessions.length,
  };
}

describe("cross-site request check", () => {
  it.each([
    ["a foreign site", EVIL_ORIGIN],
    ["an opaque origin", "null"],
    ["a malformed origin", "not an origin"],
    ["a configured origin on another port", "http://127.0.0.1:5174"],
  ])(
    "refuses a signed-in write from %s and writes nothing",
    async (_, origin) => {
      const { server, db, cookie } = await startSignedInServer();

      await expect(
        send(server, "POST", "/channels", channel, { cookie, origin }),
      ).resolves.toMatchObject({
        status: 403,
        body: { error: { code: "forbidden_origin" } },
      });
      await expect(countRows(db)).resolves.toMatchObject({ channels: 0 });
    },
  );

  it.each([
    ["the web origin", { origin: WEB_ORIGIN }],
    ["the web origin spelled differently", { origin: "HTTP://127.0.0.1:5173" }],
    ["the public base URL", { origin: plexSettingsFixture.publicBaseUrl }],
    ["no Origin header", {}],
  ])("accepts a signed-in write from %s", async (_, headers) => {
    const { server, cookie } = await startSignedInServer();

    await expect(
      send(server, "POST", "/channels", channel, { cookie, ...headers }),
    ).resolves.toMatchObject({ status: 201 });
  });

  it("lets a foreign site read, which changes nothing", async () => {
    const { server, cookie } = await startSignedInServer();

    await expect(
      send(server, "GET", "/channels", undefined, {
        cookie,
        origin: EVIL_ORIGIN,
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("refuses setup from a foreign site and creates no account", async () => {
    const { server, db } = await startTestServer({ auth: "real" });

    await expect(
      send(
        server,
        "POST",
        "/auth/setup",
        { displayName: "Owner", password: "correct horse" },
        { origin: EVIL_ORIGIN },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { error: { code: "forbidden_origin" } },
    });
    await expect(countRows(db)).resolves.toEqual({
      channels: 0,
      accounts: 0,
      sessions: 0,
    });
  });

  it("refuses a login from a foreign site and starts no session", async () => {
    const { server, db } = await startSignedInServer();

    const response = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password: "correct horse" },
      headers: { origin: EVIL_ORIGIN },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await expect(countRows(db)).resolves.toMatchObject({ sessions: 1 });
  });

  it("refuses a logout from a foreign site and keeps the session", async () => {
    const { server, cookie } = await startSignedInServer();

    const response = await server.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie, origin: EVIL_ORIGIN },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await expect(
      send(server, "GET", "/channels", undefined, { cookie }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("accepts login and logout from the web origin", async () => {
    const { server, cookie } = await startSignedInServer();

    await expect(
      server.inject({
        method: "POST",
        url: "/auth/login",
        payload: { password: "correct horse" },
        headers: { origin: WEB_ORIGIN },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      server.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie, origin: WEB_ORIGIN },
      }),
    ).resolves.toMatchObject({ statusCode: 204 });
  });

  it("refuses a foreign write to an unmatched route with 403, not 401 or 404", async () => {
    const { server } = await startSignedInServer();

    await expect(
      send(server, "POST", "//channels", channel, { origin: EVIL_ORIGIN }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("still answers a CORS preflight from the web origin", async () => {
    const { server } = await startSignedInServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/channels",
      headers: {
        origin: WEB_ORIGIN,
        "access-control-request-method": "POST",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});

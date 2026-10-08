import { afterEach, describe, expect, it } from "vitest";

import { send, signIn } from "../../testing/api-requests.js";
import { manualClock } from "../../testing/manual-clock.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import { AuthService } from "../auth-service.js";

afterEach(cleanUpTestEnvironment);

const WEB_ORIGIN = "http://127.0.0.1:5173";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Starts a server gated by the real auth service. */
function startGatedServer() {
  return startTestServer({ auth: "real" });
}

describe("auth gate", () => {
  it("answers a gated route 401 setup_required before setup", async () => {
    const { server } = await startGatedServer();

    await expect(send(server, "GET", "/channels")).resolves.toMatchObject({
      status: 401,
      body: { error: { code: "setup_required" } },
    });
  });

  it("answers a gated route 401 unauthenticated after setup without a session", async () => {
    const { server } = await startGatedServer();
    await signIn(server);

    await expect(send(server, "GET", "/channels")).resolves.toMatchObject({
      status: 401,
      body: { error: { code: "unauthenticated" } },
    });
    await expect(
      send(server, "GET", "/channels", undefined, {
        cookie: "krazitv_session=forged",
      }),
    ).resolves.toMatchObject({
      status: 401,
      body: { error: { code: "unauthenticated" } },
    });
  });

  it("lets a valid session through to the handler", async () => {
    const { server } = await startGatedServer();
    const { cookie } = await signIn(server);

    await expect(
      send(server, "GET", "/channels", undefined, { cookie }),
    ).resolves.toEqual({ status: 200, body: [] });
  });

  it("refuses a gated write without a session and runs no handler", async () => {
    const { server, db } = await startGatedServer();
    await signIn(server);

    await expect(
      send(server, "POST", "/channels", { number: "1", name: "Sneaky" }),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      db.selectFrom("channels").select("id").execute(),
    ).resolves.toEqual([]);
  });

  it("stops honoring a session once it expires", async () => {
    const clock = manualClock(1_700_000_000_000);
    const { server } = await startTestServer({
      auth: "real",
      overrides: (db) => ({ auth: new AuthService(db, { now: clock.now }) }),
    });
    const { cookie } = await signIn(server);

    clock.advance(30 * DAY_MS);

    await expect(
      send(server, "GET", "/channels", undefined, { cookie }),
    ).resolves.toMatchObject({
      status: 401,
      body: { error: { code: "unauthenticated" } },
    });
  });

  it("keeps /plex/setup gated, because it is admin information", async () => {
    const { server } = await startGatedServer();
    await signIn(server);

    await expect(send(server, "GET", "/plex/setup")).resolves.toMatchObject({
      status: 401,
    });
  });

  it("answers public routes, and HEAD on them, without a session", async () => {
    const { server } = await startGatedServer();
    await signIn(server);

    await expect(send(server, "GET", "/health")).resolves.toEqual({
      status: 200,
      body: { status: "ok" },
    });
    await expect(
      server.inject({ method: "HEAD", url: "/lineup.json" }),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it.each([
    ["an unknown route", "GET", "/no-such-route"],
    ["a doubled slash", "GET", "//channels"],
    ["a trailing slash", "GET", "/channels/"],
    ["a case change", "GET", "/CHANNELS"],
    ["a doubled slash on a write", "DELETE", "//channels/any"],
    ["a trailing slash on a public route", "GET", "/health/"],
  ] as const)(
    // With a session each lands on the 404 handler or, like /channels/
    // matching /channels/:id with an empty ID, on a gated handler that 404s.
    "answers %s 401 without a session, and 404 with one",
    async (_, method, url) => {
      const { server } = await startGatedServer();
      const { cookie } = await signIn(server);

      await expect(send(server, method, url)).resolves.toMatchObject({
        status: 401,
        body: { error: { code: "unauthenticated" } },
      });
      await expect(
        send(server, method, url, undefined, { cookie }),
      ).resolves.toMatchObject({ status: 404 });
    },
  );

  it("gates a percent-encoded path by the route it decodes to", async () => {
    const { server } = await startGatedServer();
    await signIn(server);

    await expect(send(server, "GET", "/%63hannels")).resolves.toMatchObject({
      status: 401,
    });
    await expect(
      send(server, "GET", "/channels?x=/health"),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("answers a CORS preflight from the web origin with credentials allowed", async () => {
    const { server } = await startGatedServer();
    await signIn(server);

    const response = await server.inject({
      method: "OPTIONS",
      url: "/channels",
      headers: {
        origin: WEB_ORIGIN,
        "access-control-request-method": "DELETE",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("lets the web origin read a 401, so the web app can show the logon screen", async () => {
    const { server } = await startGatedServer();

    const response = await server.inject({
      method: "GET",
      url: "/channels",
      headers: { origin: WEB_ORIGIN },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});

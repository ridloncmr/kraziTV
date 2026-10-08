// Every registered route must be decided: public (listed in public-routes.ts)
// or gated (listed below). A new route fails this suite until it is added to
// one list, so nothing ships unprotected or unreachable by accident.
import { SignalError } from "@krazitv/signal";
import type {
  FastifyInstance,
  HTTPMethods,
  InjectOptions,
  RouteOptions,
} from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { signIn } from "../../testing/api-requests.js";
import { ControlledChannelStreams } from "../../testing/controlled-channel-streams.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import { isPublicRoute, PUBLIC_ROUTES } from "./public-routes.js";

afterEach(cleanUpTestEnvironment);

// HEAD twins of these GET routes are covered by their GET entry.
const GATED_ROUTES = [
  "PATCH /account",
  "PUT /account/password",
  "GET /media-roots",
  "POST /media-roots",
  "GET /media-roots/folders",
  "PATCH /media-roots/:id",
  "GET /media-roots/:id/scan",
  "POST /media-roots/:id/scan",
  "DELETE /media-roots/:id/scan",
  "GET /media-items",
  "POST /media-items/search",
  "POST /media-items/matches",
  "GET /media-items/:id",
  "GET /media-collections",
  "POST /media-collections",
  "GET /media-collections/:id",
  "PATCH /media-collections/:id",
  "DELETE /media-collections/:id",
  "GET /media-collections/:id/items",
  "PUT /media-collections/:id/items",
  "GET /media-collections/:id/status",
  "POST /catalog-removals",
  "POST /catalog-removals/preview",
  "GET /channels",
  "POST /channels",
  "GET /channels/:id",
  "PATCH /channels/:id",
  "DELETE /channels/:id",
  "GET /channels/:id/schedule",
  "POST /channels/:id/schedule/generate",
  "GET /channels/:id/programming-blocks",
  "POST /channels/:id/programming-blocks",
  "PATCH /channels/:id/programming-blocks/:blockId",
  "DELETE /channels/:id/programming-blocks/:blockId",
  "GET /channels/:id/playout",
  "GET /channels/:id/now",
  "GET /plex/setup",
];

interface RegisteredRoute {
  method: HTTPMethods;
  url: string;
}

/** Starts a really gated server and records every route it registers. */
async function startRecordedServer() {
  const routes: RegisteredRoute[] = [];
  const streams = new ControlledChannelStreams();
  const { server } = await startTestServer({
    auth: "real",
    overrides: () => ({ channelStreams: streams }),
    onRoute: (route: RouteOptions) => {
      for (const method of [route.method].flat()) {
        routes.push({ method, url: route.url });
      }
    },
  });
  await server.ready();
  return { server, routes, streams };
}

/** Fills route parameters and wildcards so the pattern matches itself. */
function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, "unknown").replace("*", "anything");
}

/**
 * Sends one request to a route. A tune parks until its subscribe settles, so
 * the stream route's subscribe is failed as an unknown channel.
 */
async function request(
  server: FastifyInstance,
  streams: ControlledChannelStreams,
  route: RegisteredRoute,
  cookie?: string,
) {
  const response = server.inject({
    // Fastify routes and light-my-request name the same methods in two types.
    method: route.method as InjectOptions["method"],
    url: concreteUrl(route.url),
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
  if (route.url === "/channels/:id/stream") {
    const call = await streams.nextSubscribe();
    call.fail(
      new SignalError("channel_not_found", "unknown channel", {
        channelId: call.channelId,
      }),
    );
  }
  return response;
}

/**
 * Describes a response the gate got wrong, or undefined when it was right: a
 * gated route must answer 401 with `gatedCode` (HEAD answers carry no body,
 * so only their status is checked) and a public route must never answer 401.
 */
function misjudged(
  route: RegisteredRoute,
  response: { statusCode: number; body: string },
  gatedCode: string,
): string | undefined {
  // Only a 401 is the gate speaking; other bodies may be XML or a stream.
  const code =
    response.statusCode !== 401 || response.body === ""
      ? undefined
      : (JSON.parse(response.body) as { error?: { code?: string } }).error
          ?.code;
  const right = isPublicRoute(route.method, route.url)
    ? response.statusCode !== 401
    : response.statusCode === 401 &&
      (route.method === "HEAD" || code === gatedCode);
  return right
    ? undefined
    : `${route.method} ${route.url} -> ${response.statusCode} ${code}`;
}

/** Names a route with its HEAD twin folded into its GET entry. */
function listedName(route: RegisteredRoute): string {
  return `${route.method === "HEAD" ? "GET" : route.method} ${route.url}`;
}

describe("auth gate route coverage", () => {
  it("decides every registered route as either public or gated", async () => {
    const { routes } = await startRecordedServer();

    const undecided = routes.filter(
      (route) =>
        !isPublicRoute(route.method, route.url) &&
        !GATED_ROUTES.includes(listedName(route)),
    );
    const listedPublicAndGated = routes.filter(
      (route) =>
        isPublicRoute(route.method, route.url) &&
        GATED_ROUTES.includes(listedName(route)),
    );
    const registered = new Set(routes.map(listedName));
    // A stale public entry would silently open a later route at its pattern.
    const stale = [...PUBLIC_ROUTES, ...GATED_ROUTES].filter(
      (name) => !registered.has(name),
    );

    expect({ undecided, listedPublicAndGated, stale }).toEqual({
      undecided: [],
      listedPublicAndGated: [],
      stale: [],
    });
  });

  it("answers every gated route 401 setup_required before setup, and no public one 401", async () => {
    const { server, routes, streams } = await startRecordedServer();

    const wrong: string[] = [];
    for (const route of routes) {
      const response = await request(server, streams, route);
      const verdict = misjudged(route, response, "setup_required");
      if (verdict !== undefined) wrong.push(verdict);
    }

    expect(wrong).toEqual([]);
  });

  it("answers every gated route 401 unauthenticated without a session, and no public one 401", async () => {
    const { server, routes, streams } = await startRecordedServer();
    await signIn(server);

    const wrong: string[] = [];
    for (const route of routes) {
      const response = await request(server, streams, route);
      const verdict = misjudged(route, response, "unauthenticated");
      if (verdict !== undefined) wrong.push(verdict);
    }

    expect(wrong).toEqual([]);
  });

  it("lets a session through to every gated route", async () => {
    const { server, routes, streams } = await startRecordedServer();
    const { cookie } = await signIn(server);

    const refused: string[] = [];
    for (const route of routes) {
      if (isPublicRoute(route.method, route.url)) continue;
      const response = await request(server, streams, route, cookie);
      if (response.statusCode === 401) refused.push(listedName(route));
    }

    expect(refused).toEqual([]);
  });
});

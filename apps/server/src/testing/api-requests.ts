// HTTP request helpers for route and acceptance tests only; production code must never import this module.
import type { FastifyInstance, InjectOptions } from "fastify";

/**
 * Sends one JSON request and returns the status with the parsed body, if any.
 * Pass headers such as a session `cookie` when the server gates with real auth.
 */
export async function send(
  server: FastifyInstance,
  method: InjectOptions["method"],
  url: string,
  payload?: InjectOptions["payload"],
  headers: InjectOptions["headers"] = {},
) {
  const response = await server.inject({ method, url, payload, headers });
  return {
    status: response.statusCode,
    body: response.body === "" ? undefined : response.json(),
  };
}

/**
 * Polls a root's scan job until it reaches a terminal phase and returns that
 * status, failing on a 404 or when the job is still running after `timeoutMs`.
 */
export async function waitForScan(
  server: FastifyInstance,
  rootId: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status, body } = await send(
      server,
      "GET",
      `/media-roots/${rootId}/scan`,
    );
    if (status !== 200) {
      throw new Error(
        `Scan of ${rootId} read ${status}: ${JSON.stringify(body)}`,
      );
    }
    const { phase } = body as { phase: string };
    if (["completed", "failed", "cancelled"].includes(phase)) return body;
    if (Date.now() > deadline) {
      throw new Error(`Scan of ${rootId} still ${phase} after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Creates a channel and returns Fastify's raw response, for tests asserting headers or exact JSON. */
export function createChannel(
  server: FastifyInstance,
  payload: InjectOptions["payload"],
  headers: InjectOptions["headers"] = {},
) {
  return server.inject({ method: "POST", url: "/channels", payload, headers });
}

/**
 * Sets up the account on a server gated with real auth and returns the
 * `cookie` header its session cookie becomes, for admin requests.
 */
export async function signIn(
  server: FastifyInstance,
): Promise<{ cookie: string }> {
  const response = await server.inject({
    method: "POST",
    url: "/auth/setup",
    payload: { displayName: "Owner", password: "correct horse" },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Setup answered ${response.statusCode}: ${response.body}`);
  }
  return { cookie: cookieOf(response) };
}

/** Logs in with `password` and returns the raw response, for header and cookie assertions. */
export function logIn(server: FastifyInstance, password: unknown) {
  return server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { password } as object,
  });
}

/** Returns the `name=value` pair a browser would send back from a `Set-Cookie` response. */
export function cookieOf(response: {
  headers: Record<string, unknown>;
}): string {
  return String(response.headers["set-cookie"]).split(";")[0];
}

/** Patches a channel and returns Fastify's raw response; pending calls let tests race lifecycle changes. */
export function updateChannel(
  server: FastifyInstance,
  id: string,
  payload: InjectOptions["payload"],
) {
  return server.inject({ method: "PATCH", url: `/channels/${id}`, payload });
}

/** Formats an epoch millisecond as the UTC instant the API accepts. */
export function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Builds a `[start, end)` window URL for a route such as `/schedule` or `/playout`. */
export function windowUrl(url: string, start: number, end: number): string {
  return `${url}?start=${iso(start)}&end=${iso(end)}`;
}

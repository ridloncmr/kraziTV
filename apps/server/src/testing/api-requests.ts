// HTTP request helpers for route and acceptance tests only; production code must never import this module.
import type { FastifyInstance, InjectOptions } from "fastify";

/** Sends one JSON request and returns the status with the parsed body, if any. */
export async function send(
  server: FastifyInstance,
  method: InjectOptions["method"],
  url: string,
  payload?: InjectOptions["payload"],
) {
  const response = await server.inject({ method, url, payload });
  return {
    status: response.statusCode,
    body: response.body === "" ? undefined : response.json(),
  };
}

/** Creates a channel and returns Fastify's raw response, for tests asserting headers or exact JSON. */
export function createChannel(
  server: FastifyInstance,
  payload: InjectOptions["payload"],
) {
  return server.inject({ method: "POST", url: "/channels", payload });
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

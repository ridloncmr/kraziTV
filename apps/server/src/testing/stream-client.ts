// Real-socket HTTP helpers for stream route tests; inject cannot read an unending body.
import { get, type ClientRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";

/** One open stream request and its response, once headers arrive. */
export interface StreamClient {
  request: ClientRequest;
  response: IncomingMessage;
}

/** Listens on an ephemeral loopback port so tests can open real sockets. */
export async function listenOnLoopback(
  server: FastifyInstance,
): Promise<string> {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const { port } = server.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Sends a GET and resolves on response headers, leaving the body unread. */
export function openStreamRequest(url: string): Promise<StreamClient> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => resolve({ request, response }));
    request.once("error", reject);
  });
}

/** Sends a GET without waiting for headers, so a test can abandon the tune. */
export function startStreamRequest(url: string): ClientRequest {
  const request = get(url);
  // An abandoned tune ends in a socket reset the test caused on purpose.
  request.once("error", () => {});
  return request;
}

/** Resolves with the next body chunk, so a test sees bytes actually flow. */
export function readChunk(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    response.once("data", (chunk: Buffer) => {
      response.pause();
      resolve(chunk);
    });
    response.once("error", reject);
    response.resume();
  });
}

/** Resolves once the response stops, by normal end or by abort. */
export function responseFinished(response: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    if (response.closed) return resolve();
    response.once("close", () => resolve());
    response.resume();
  });
}

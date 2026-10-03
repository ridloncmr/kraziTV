import { SignalError, type SignalErrorCode } from "@krazitv/signal";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureLogLines } from "../../testing/captured-log-lines.js";
import { ControlledChannelStreams } from "../../testing/controlled-channel-streams.js";
import {
  listenOnLoopback,
  openStreamRequest,
  readChunk,
  responseFinished,
  startStreamRequest,
} from "../../testing/stream-client.js";
import { settleWithin } from "../../testing/settle-within.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const CHANNEL_ID = "channel-1";
const STREAM_URL = `/channels/${CHANNEL_ID}/stream`;
const MEDIA_PATH = "/media/private/show.mkv";

// Boots the server over a controllable stream manager, capturing log lines so
// tests can assert what the route logged after a response began.
async function startStreamServer() {
  const streams = new ControlledChannelStreams();
  const { lines: logs, stream } = captureLogLines();
  const { server } = await startTestServer({
    overrides: () => ({ channelStreams: streams }),
    logger: { level: "info", stream },
  });
  return { server, streams, logs };
}

describe("GET /channels/:id/stream startup failures", () => {
  it.each<[SignalErrorCode, number, string, boolean]>([
    ["channel_not_found", 404, "channel_not_found", false],
    ["channel_disabled", 409, "channel_disabled", false],
    ["no_current_playout", 409, "no_current_playout", false],
    ["playout_unavailable", 503, "playout_unavailable", true],
    ["worker_startup_timeout", 503, "stream_startup_timeout", true],
    ["manager_shutdown", 503, "stream_unavailable", true],
    ["runtime_cleanup_failed", 503, "stream_unavailable", true],
    ["packaging_stopped", 503, "stream_unavailable", true],
    ["media_unavailable", 500, "stream_failed", false],
    ["invalid_playout_item", 500, "stream_failed", false],
    ["packaging_start_failed", 500, "stream_failed", false],
    ["packaging_failed", 500, "stream_failed", false],
    ["transition_failed", 500, "stream_failed", false],
    ["invalid_channel_authorization", 500, "stream_failed", false],
  ])(
    "maps %s to %i %s without exposing media details",
    async (signalCode, status, apiCode, retryable) => {
      const { server, streams } = await startStreamServer();

      const response = server.inject({ method: "GET", url: STREAM_URL });
      const call = await streams.nextSubscribe();
      call.fail(
        new SignalError(signalCode, `failed reading ${MEDIA_PATH}`, {
          channelId: CHANNEL_ID,
          mediaPath: MEDIA_PATH,
        }),
      );
      const { statusCode, headers, body } = await response;

      expect(statusCode).toBe(status);
      expect(headers["content-type"]).toMatch(/^application\/json/);
      expect(JSON.parse(body)).toEqual({
        error: {
          code: apiCode,
          message: expect.stringContaining(CHANNEL_ID) as string,
          ...(retryable ? { retryable: true } : {}),
        },
      });
      expect(body).not.toContain(MEDIA_PATH);
    },
  );

  it("answers an unexpected failure with the generic internal error", async () => {
    const { server, streams } = await startStreamServer();

    const response = server.inject({ method: "GET", url: STREAM_URL });
    (await streams.nextSubscribe()).fail(new Error(`boom at ${MEDIA_PATH}`));
    const { statusCode, body } = await response;

    expect(statusCode).toBe(500);
    expect(JSON.parse(body)).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });
});

describe("GET /channels/:id/stream during shutdown", () => {
  it("answers a pending tune with a retryable 503 when the server closes", async () => {
    const { server, streams } = await startStreamServer();

    const response = server.inject({ method: "GET", url: STREAM_URL });
    await streams.nextSubscribe();
    await settleWithin(server.close(), 2_000, "server close");
    const { statusCode, body } = await response;

    expect(statusCode).toBe(503);
    expect(JSON.parse(body)).toMatchObject({
      error: { code: "stream_unavailable", retryable: true },
    });
  });
});

describe("GET /channels/:id/stream success", () => {
  it("streams the subscription's bytes as video/MP2T", async () => {
    const { server, streams } = await startStreamServer();

    const response = server.inject({ method: "GET", url: STREAM_URL });
    const call = await streams.nextSubscribe();
    const subscription = call.open();
    subscription.stream.end(Buffer.from("ts-bytes"));
    const { statusCode, headers, body } = await response;

    expect(call.channelId).toBe(CHANNEL_ID);
    expect(statusCode).toBe(200);
    expect(headers["content-type"]).toBe("video/MP2T");
    expect(body).toBe("ts-bytes");
    expect(subscription.closeCount).toBe(1);
  });

  it("closes the subscription once when the viewer disconnects", async () => {
    const { server, streams } = await startStreamServer();
    const baseUrl = await listenOnLoopback(server);

    const opening = openStreamRequest(`${baseUrl}${STREAM_URL}`);
    const subscription = (await streams.nextSubscribe()).open();
    subscription.stream.write(Buffer.from("first"));
    const { request, response } = await opening;
    expect(await readChunk(response)).toEqual(Buffer.from("first"));

    request.destroy();

    await vi.waitFor(() => expect(subscription.closeCount).toBe(1));
    subscription.stream.write(Buffer.from("after"));
    expect(subscription.closeCount).toBe(1);
  });

  it("ends the response and logs when the subscription ends after streaming began", async () => {
    const { server, streams, logs } = await startStreamServer();
    const baseUrl = await listenOnLoopback(server);

    const opening = openStreamRequest(`${baseUrl}${STREAM_URL}`);
    const subscription = (await streams.nextSubscribe()).open();
    subscription.stream.write(Buffer.from("first"));
    const { response } = await opening;
    await readChunk(response);

    subscription.stream.destroy();
    await responseFinished(response);

    await vi.waitFor(() =>
      expect(logs).toContainEqual(
        expect.objectContaining({
          msg: "Channel stream ended before the viewer disconnected",
          channelId: CHANNEL_ID,
        }),
      ),
    );
    expect(subscription.closeCount).toBe(1);
  });
});

describe("GET /channels/:id/stream abandoned tune", () => {
  it("cancels a pending subscription when the viewer disconnects first", async () => {
    const { server, streams } = await startStreamServer();
    const baseUrl = await listenOnLoopback(server);

    const request = startStreamRequest(`${baseUrl}${STREAM_URL}`);
    const call = await streams.nextSubscribe();
    request.destroy();

    await vi.waitFor(() => expect(call.signal?.aborted).toBe(true));
  });

  it("sends nothing and logs no failure when the tune fails after the viewer left", async () => {
    const { server, streams, logs } = await startStreamServer();
    const baseUrl = await listenOnLoopback(server);

    const request = startStreamRequest(`${baseUrl}${STREAM_URL}`);
    const call = await streams.nextSubscribe();
    request.destroy();
    await vi.waitFor(() => expect(call.signal?.aborted).toBe(true));
    call.fail(new SignalError("subscription_aborted", "cancelled"));
    await server.close();

    expect(logs.filter((line) => line.level >= 40)).toEqual([]);
  });

  it("closes a subscription that completes after the viewer left", async () => {
    const { server, streams } = await startStreamServer();
    const baseUrl = await listenOnLoopback(server);

    const request = startStreamRequest(`${baseUrl}${STREAM_URL}`);
    const call = await streams.nextSubscribe();
    request.destroy();
    await vi.waitFor(() => expect(call.signal?.aborted).toBe(true));

    const subscription = call.open();

    await vi.waitFor(() => expect(subscription.closeCount).toBe(1));
  });
});

import { SignalError, type ChannelSubscription } from "@krazitv/signal";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  sendApiError,
  sendChannelDisabled,
  sendChannelNotFound,
} from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import type { ChannelStreams } from "../contracts.js";

const STREAM_ROUTE = "/channels/:id/stream";

/**
 * Fills the stream route's own pattern, so provider adapters link to the
 * route without a second copy of its path. The ID is encoded because channel
 * IDs are opaque strings.
 */
export function channelStreamPath(id: string): string {
  return STREAM_ROUTE.replace(":id", encodeURIComponent(id));
}

/**
 * Registers the provider-neutral stream route. A request owns one viewer's
 * subscription only; the manager owns the worker and its FFmpeg processes.
 */
export function registerChannelStreamRoutes(
  server: FastifyInstance,
  streams: ChannelStreams,
): void {
  server.get(STREAM_ROUTE, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // Before headers are sent, the response closing means the viewer left.
    const abandoned = new AbortController();
    const abandon = () => abandoned.abort();
    reply.raw.once("close", abandon);

    let subscription: ChannelSubscription;
    try {
      subscription = await streams.subscribe(id, { signal: abandoned.signal });
    } catch (error) {
      if (abandoned.signal.aborted) return reply.hijack();
      if (!(error instanceof SignalError)) throw error;
      request.log.warn({ err: error, channelId: id }, "Channel tune failed");
      return sendStartupFailure(reply, id, error);
    } finally {
      reply.raw.off("close", abandon);
    }
    if (abandoned.signal.aborted) {
      subscription.close();
      return reply.hijack();
    }

    let viewerLeft = false;
    let closed = false;
    // Every exit path funnels here so the manager's viewer count drops once.
    const closeSubscription = () => {
      if (closed) return;
      closed = true;
      subscription.close();
    };
    reply.raw.once("close", () => {
      viewerLeft = true;
      closeSubscription();
    });
    subscription.stream.once("close", () => {
      if (!viewerLeft) {
        request.log.warn(
          { channelId: id },
          "Channel stream ended before the viewer disconnected",
        );
      }
      closeSubscription();
    });

    return reply.type("video/MP2T").send(subscription.stream);
  });
}

/**
 * Maps a typed tune failure to the spec 0006 status table. Messages name only
 * the channel, because error details can carry media paths.
 */
function sendStartupFailure(
  reply: FastifyReply,
  id: string,
  error: SignalError,
): FastifyReply {
  switch (error.code) {
    case "channel_not_found":
      return sendChannelNotFound(reply, id);
    case "channel_disabled":
      return sendChannelDisabled(reply, id);
    case "no_current_playout":
      return sendApiError(
        reply,
        409,
        "no_current_playout",
        `Channel ${id} has nothing airing now`,
      );
    case "playout_unavailable":
      return sendApiError(
        reply,
        503,
        "playout_unavailable",
        `Channel ${id} playout is temporarily unavailable; retry the request`,
        { retryable: true },
      );
    case "worker_startup_timeout":
      return sendApiError(
        reply,
        503,
        "stream_startup_timeout",
        `Channel ${id} did not start streaming in time; retry the request`,
        { retryable: true },
      );
    case "manager_shutdown":
    case "runtime_cleanup_failed":
    case "packaging_stopped":
      return sendApiError(
        reply,
        503,
        "stream_unavailable",
        `Channel ${id} cannot stream right now; retry the request`,
        { retryable: true },
      );
    default:
      return sendApiError(
        reply,
        500,
        "stream_failed",
        `Channel ${id} failed to start streaming`,
      );
  }
}

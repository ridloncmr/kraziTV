import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendInvalidRequest,
  sendMediaRootNotFound,
  sendUnknownMediaItems,
} from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { uniqueMediaItemIds } from "../../http/request-schemas.js";
import type { CatalogRemovalService } from "../catalog-removal-service.js";
import type {
  CatalogRemoval,
  CatalogRemovalImpact,
  CatalogRemovalRefusal,
} from "../contracts.js";

// Both routes take the same body; the preview ignores what only a removal uses.
const removalBody = z.strictObject({
  target: z.union([
    z.strictObject({ mediaRootId: z.string() }),
    z.strictObject({
      mediaItemIds: uniqueMediaItemIds.min(1, "mediaItemIds must not be empty"),
    }),
  ]),
  airing: z.enum(["finish", "interrupt"]).default("finish"),
  allowUnschedulable: z.boolean().default(false),
});

/**
 * Stops one interrupted channel's stream worker under its lifecycle lock and
 * the runtime stop deadline; false when the stop failed or missed it.
 */
type StopInterrupted = (
  channelId: string,
  log: Pick<FastifyBaseLogger, "error">,
) => Promise<boolean>;

/**
 * Registers the catalog removal routes; validation and status mapping live
 * only here. After a removal commits, each interrupted channel's worker is
 * stopped so its viewers tune in to the rebuilt schedule.
 */
export function registerCatalogRemovalRoutes(
  server: FastifyInstance,
  removals: CatalogRemovalService,
  stopInterrupted: StopInterrupted,
): void {
  server.post("/catalog-removals/preview", async (request, reply) => {
    const body = removalBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const read = await removals.preview(body.data.target);
    if (read.kind !== "impact") return sendRefusal(reply, read);
    return toApiImpact(read.impact);
  });

  server.post("/catalog-removals", async (request, reply) => {
    const body = removalBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const outcome = await removals.remove(body.data, request.log);
    if (outcome.kind !== "removed") return sendRefusal(reply, outcome);
    const { removal } = outcome;
    // Different channels never wait on each other, so all stops run at once.
    // A failed stop rolls nothing back: it is logged and reported, and the
    // worker moves to the new schedule by itself at the old entry's end.
    const settled = await Promise.all(
      removal.interruptedChannelIds.map((id) =>
        stopInterrupted(id, request.log),
      ),
    );
    const stopFailedChannelIds = removal.interruptedChannelIds.filter(
      (_, index) => !settled[index],
    );
    return toApiRemoval(removal, stopFailedChannelIds);
  });
}

// Maps each refusal to its status and structured error code.
function sendRefusal(
  reply: FastifyReply,
  refusal: CatalogRemovalRefusal,
): FastifyReply {
  switch (refusal.kind) {
    case "media_root_not_found":
      return sendMediaRootNotFound(reply, refusal.mediaRootId);
    case "unknown_media_items":
      return sendUnknownMediaItems(reply, refusal.mediaItemIds);
    case "scan_in_progress":
      return sendApiError(
        reply,
        409,
        "scan_in_progress",
        "The media root holding this media is being scanned; cancel the scan or wait for it to finish",
      );
    case "media_item_in_use":
      return sendApiError(
        reply,
        409,
        "media_item_in_use",
        `Programming blocks on channels ${refusal.channelIds.join(", ")} play this media directly; change those blocks first`,
        { channelIds: refusal.channelIds, mediaItemIds: refusal.mediaItemIds },
      );
    case "channels_left_unschedulable":
      return sendApiError(
        reply,
        409,
        "channels_left_unschedulable",
        "This removal leaves enabled channels with nothing to schedule; confirm with allowUnschedulable",
        { impact: toApiImpact(refusal.impact) },
      );
  }
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiImpact(impact: CatalogRemovalImpact) {
  return {
    itemCount: impact.itemCount,
    airing: impact.airing.map((entry) => ({
      channelId: entry.channelId,
      channelNumber: entry.channelNumber,
      mediaItemId: entry.mediaItemId,
      title: entry.title,
      endsAt: toApiTimestamp(entry.endsAt),
    })),
    channelsLeftUnschedulable: impact.channelsLeftUnschedulable.map(
      ({ channelId, channelNumber }) => ({ channelId, channelNumber }),
    ),
    affectedChannelIds: impact.affectedChannelIds,
  };
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API
// promises, and adds the stops that failed after the commit.
function toApiRemoval(removal: CatalogRemoval, stopFailedChannelIds: string[]) {
  return {
    removedItemCount: removal.removedItemCount,
    finishing: removal.finishing.map(({ channelId, endsAt }) => ({
      channelId,
      endsAt: toApiTimestamp(endsAt),
    })),
    interruptedChannelIds: removal.interruptedChannelIds,
    stopFailedChannelIds,
    affectedChannelIds: removal.affectedChannelIds,
  };
}

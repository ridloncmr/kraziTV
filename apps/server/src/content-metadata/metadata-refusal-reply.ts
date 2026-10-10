import type { FastifyReply, FastifyRequest } from "fastify";

import { sendApiError, sendMediaItemNotFound } from "../http/api-error.js";
import type { MetadataRefusal } from "./contracts.js";

/**
 * Maps why a decision changed nothing to its answer. A TMDB failure's reason
 * is logged, not sent: it names the outage, which the owner cannot act on.
 */
export function sendMetadataRefusal(
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  refusal: MetadataRefusal,
): FastifyReply {
  switch (refusal.kind) {
    case "mapping_changed":
      return sendApiError(
        reply,
        409,
        "mapping_changed",
        "A track's details changed while the mapping was being read. Reopen the mapping before applying it.",
      );
    case "item_not_found":
      return sendMediaItemNotFound(reply, id);
    case "not_ambiguous":
      return sendApiError(
        reply,
        409,
        "match_not_ambiguous",
        "This item's match has changed. Reopen it to see where it stands.",
      );
    case "candidate_not_offered":
      return sendApiError(
        reply,
        400,
        "candidate_not_offered",
        "Choose one of the candidates this item offers.",
      );
    case "tmdb_key_missing":
      return sendApiError(
        reply,
        409,
        "tmdb_key_required",
        "Set up TMDB in Account Settings first.",
      );
    case "lookup_failed":
      request.log.warn(
        { reason: refusal.reason },
        "Could not read TMDB for a match decision",
      );
      return sendApiError(
        reply,
        502,
        "tmdb_unreachable",
        "kraziTV could not read TMDB. Try again later.",
      );
    case "episode_not_in_series":
      return sendApiError(
        reply,
        409,
        "episode_not_in_series",
        "TMDB lists no such episode in that series. Choose another.",
      );
    case "not_rejectable":
      return sendApiError(
        reply,
        409,
        "match_not_rejectable",
        "Only a matched item or one that needs a choice can be rejected.",
      );
    case "not_rejected":
      return sendApiError(
        reply,
        409,
        "match_not_rejected",
        "This item's match is not rejected.",
      );
    case "not_matched":
      return sendApiError(
        reply,
        409,
        "match_not_matched",
        "This item's match has changed. Reopen it to see where it stands.",
      );
    case "not_disc_track":
      return sendApiError(
        reply,
        409,
        "not_disc_track",
        "Only a disc-track file can be mapped to episodes.",
      );
    case "season_not_in_series":
      return sendApiError(
        reply,
        409,
        "season_not_in_series",
        "TMDB lists no such season in that series. Choose another.",
      );
    case "track_not_in_folder":
      return sendApiError(
        reply,
        400,
        "track_not_in_folder",
        "Map only the disc tracks this folder holds.",
      );
  }
}

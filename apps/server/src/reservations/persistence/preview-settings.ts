import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type {
  PreviewSettings,
  ReservationRefusal,
  ReservationSettings,
} from "../contracts.js";
import { listFromBeginning } from "./reservation-rows.js";

/** What a preview would save, or why its source cannot be saved. */
type ResolvedPreviewSettings =
  | {
      kind: "resolved";
      /** The settings a save made from this preview carries. */
      settings: ReservationSettings;
      /** The reservation an edit's preview leaves out, as the save will. */
      replacesReservationId: string | undefined;
      /** A collection from the beginning, resolved into the list to save. */
      resolvedMediaItemIds: string[] | undefined;
    }
  | { kind: "refused"; refusal: ReservationRefusal };

/**
 * Turns what a preview asks about into the settings a save would carry. A
 * collection from the beginning previews as the media-item list the owner
 * then saves (programming spec 0007), so an unknown or empty collection is
 * refused here as its save would be. Reads through the caller's snapshot and
 * never writes.
 */
export async function resolvePreviewSettings(
  trx: Kysely<DatabaseSchema>,
  previewed: PreviewSettings,
): Promise<ResolvedPreviewSettings> {
  const { replacesReservationId, ...asSaved } = previewed;
  if (previewed.source.kind !== "collection_from_beginning") {
    return {
      kind: "resolved",
      settings: { ...asSaved, source: previewed.source },
      replacesReservationId,
      resolvedMediaItemIds: undefined,
    };
  }
  const resolved = await listFromBeginning(trx, previewed.source);
  if (resolved === undefined) {
    return {
      kind: "refused",
      refusal: {
        kind: "media_collection_not_found",
        mediaCollectionId: previewed.source.mediaCollectionId,
      },
    };
  }
  if (resolved.length === 0) {
    return {
      kind: "refused",
      refusal: { kind: "reservation_media_unplayable", mediaItemIds: [] },
    };
  }
  return {
    kind: "resolved",
    settings: {
      ...asSaved,
      source: { kind: "media_items", mediaItemIds: resolved },
    },
    replacesReservationId,
    resolvedMediaItemIds: resolved,
  };
}

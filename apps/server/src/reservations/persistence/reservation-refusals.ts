import {
  findRegenerationBoundary,
  fitsBefore,
  isPlayableMedia,
  isSchedulableMedia,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import { fromNullableSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { findAiringItem } from "../../playout/persistence/playout-reads.js";
import type {
  ReservationRefusal,
  ReservationSettings,
  ReservationSourceSettings,
} from "../contracts.js";

type Executor = Kysely<DatabaseSchema>;

/** A reservation that may be saved, with the end it stores. */
interface ResolvedRange {
  kind: "resolved";
  endsAt: number;
  endKind: "explicit" | "program_derived";
}

/**
 * Returns the first reason a reservation cannot be saved on the channel at
 * `now`, or the end it stores: what it airs must exist and be playable, it
 * must start in the future and at or after the regeneration boundary so the
 * airing program is never cut, a media-item list must fit its range whole,
 * and it must not overlap another of the channel's reservations. Runs in
 * the write's immediate transaction, so concurrent saves see each other.
 */
export async function resolveReservationRange(
  trx: Executor,
  channelId: string,
  settings: ReservationSettings,
  now: number,
  excludeReservationId?: string,
): Promise<ResolvedRange | ReservationRefusal> {
  const durations = await findSourceRefusal(trx, settings.source);
  if (!Array.isArray(durations)) return durations;
  const { startsAt } = settings;
  if (startsAt <= now) return { kind: "reservation_in_past", startsAt };
  const boundary = findRegenerationBoundary(
    await findAiringItem(trx, channelId, now),
    now,
  );
  if (startsAt < boundary) {
    return { kind: "reservation_crosses_airing", airingEndsAt: boundary };
  }
  const programsMs = durations.reduce((total, duration) => total + duration, 0);
  const programsEndAt = startsAt + programsMs;
  const endsAt = settings.endsAt ?? programsEndAt;
  if (!fitsBefore(startsAt, programsMs, endsAt)) {
    return { kind: "reservation_does_not_fit", programsEndAt };
  }
  const overlapping = await trx
    .selectFrom("reservations")
    .select("id")
    .where("channel_id", "=", channelId)
    .where("starts_at", "<", endsAt)
    .where("ends_at", ">", startsAt)
    .$if(excludeReservationId !== undefined, (query) =>
      query.where("id", "!=", excludeReservationId ?? ""),
    )
    .orderBy("starts_at")
    .executeTakeFirst();
  if (overlapping !== undefined) {
    return { kind: "reservation_overlap", reservationId: overlapping.id };
  }
  return {
    kind: "resolved",
    endsAt,
    endKind: settings.endsAt === null ? "program_derived" : "explicit",
  };
}

/**
 * Returns why a source cannot air, or the durations of a media-item list in
 * order (none for a collection, whose fit is decided as it airs). A listed
 * item must be in the catalog, not removed, schedulable, and playable, so
 * every reserved item can both be scheduled and transmitted.
 */
async function findSourceRefusal(
  trx: Executor,
  source: ReservationSourceSettings,
): Promise<number[] | ReservationRefusal> {
  if (source.kind === "collection") {
    const collection = await trx
      .selectFrom("media_collections")
      .select("id")
      .where("id", "=", source.mediaCollectionId)
      .executeTakeFirst();
    return collection === undefined
      ? {
          kind: "media_collection_not_found",
          mediaCollectionId: source.mediaCollectionId,
        }
      : [];
  }
  const rows = await trx
    .selectFrom("media_items")
    .select(["id", "status", "duration_ms", "has_audio", "removed_at"])
    .where("id", "in", [...new Set(source.mediaItemIds)])
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const unknown = source.mediaItemIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return {
      kind: "media_item_not_found",
      mediaItemIds: [...new Set(unknown)],
    };
  }
  const unplayable = rows.filter((row) => {
    const media = {
      status: row.status,
      durationMs: row.duration_ms,
      hasAudio: fromNullableSqliteBoolean(row.has_audio),
    };
    return (
      row.removed_at !== null ||
      !isSchedulableMedia(media) ||
      !isPlayableMedia(media)
    );
  });
  if (unplayable.length > 0) {
    return {
      kind: "reservation_media_unplayable",
      mediaItemIds: unplayable.map((row) => row.id).sort(),
    };
  }
  return source.mediaItemIds.map((id) => byId.get(id)?.duration_ms ?? 0);
}

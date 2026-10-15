import type {
  AssignmentMember,
  PlaybackMode,
  ProgrammingAssignment,
  ScheduleMedia,
  StretchSetting,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MediaItemStatus } from "../../database/schema/media-item-table.js";
import type { ProgrammingAssignmentMemberTable } from "../../database/schema/programming-assignment-member-table.js";
import type { StretchKind } from "../../database/schema/programming-source-assignment-table.js";
import {
  effectiveContentIdentity,
  effectiveMetadata,
  METADATA_COLUMNS,
  type MetadataColumns,
} from "../../media-items/effective-metadata.js";
import { selectWithMetadata } from "../../media-items/media-item-repository.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Resolves the channel's assignments into what kraziPlan generates from, in
 * saved assignment order: each member in saved member order, a collection
 * with its members in saved membership order, each item with its effective
 * ordering facts.
 */
export async function loadProgrammingAssignments(
  trx: Executor,
  channelId: string,
): Promise<ProgrammingAssignment[]> {
  const rows = await trx
    .selectFrom("programming_source_assignments")
    .selectAll()
    .where("channel_id", "=", channelId)
    .orderBy("assignment_order")
    .orderBy("id")
    .execute();
  const assignments: ProgrammingAssignment[] = [];
  for (const row of rows) {
    const members = await trx
      .selectFrom("programming_assignment_members")
      .selectAll()
      .where("assignment_id", "=", row.id)
      .orderBy("position")
      .execute();
    const resolved: AssignmentMember[] = [];
    for (const member of members) {
      resolved.push(await resolveMember(trx, member));
    }
    assignments.push({
      id: row.id,
      playbackMode: row.playback_mode,
      ordinary: toStretch({
        kind: row.ordinary_kind,
        min: row.ordinary_min,
        max: row.ordinary_max,
      }),
      members: resolved,
    });
  }
  return assignments;
}

/**
 * Returns the mode the channel's assignment plays one of its collections
 * in, or undefined unless that assignment holds the collection.
 */
export async function findAssignedCollectionMode(
  trx: Executor,
  member: {
    channelId: string;
    assignmentId: string;
    mediaCollectionId: string;
  },
): Promise<PlaybackMode | undefined> {
  const row = await trx
    .selectFrom("programming_assignment_members as member")
    .innerJoin(
      "programming_source_assignments as assignment",
      "assignment.id",
      "member.assignment_id",
    )
    .select("assignment.playback_mode")
    .where("member.channel_id", "=", member.channelId)
    .where("member.assignment_id", "=", member.assignmentId)
    .where("member.media_collection_id", "=", member.mediaCollectionId)
    .executeTakeFirst();
  return row?.playback_mode ?? undefined;
}

/** Loads a collection's members in saved membership order, as scheduling sees them. */
export async function loadCollectionMembers(
  trx: Executor,
  mediaCollectionId: string,
): Promise<ScheduleMedia[]> {
  const members = await selectScheduleMedia(trx)
    .innerJoin(
      "media_collection_items",
      "media_collection_items.media_item_id",
      "media_items.id",
    )
    .where("media_collection_items.media_collection_id", "=", mediaCollectionId)
    .orderBy("media_collection_items.position")
    .execute();
  return members.map(toScheduleMedia);
}

// Resolves one member row's media. The table check makes the named source
// column non-null and its foreign key guarantees the row.
async function resolveMember(
  trx: Executor,
  member: Pick<
    ProgrammingAssignmentMemberTable,
    "media_collection_id" | "media_item_id"
  >,
): Promise<AssignmentMember> {
  if (member.media_collection_id !== null) {
    return {
      kind: "collection",
      mediaCollectionId: member.media_collection_id,
      members: await loadCollectionMembers(trx, member.media_collection_id),
    };
  }
  const item = await selectScheduleMedia(trx)
    .where("media_items.id", "=", member.media_item_id)
    .executeTakeFirstOrThrow();
  return { kind: "media_item", media: toScheduleMedia(item) };
}

/** A stretch as an assignment's three columns store it. */
interface StretchColumns {
  kind: StretchKind;
  min: number;
  max: number | null;
}

/**
 * Reads a stretch from its columns: a count or minutes in `min`, and `max`
 * for a range only. The only decoder of stored stretches, so every reader
 * agrees on what a valid row is; the table checks make any other shape
 * corruption.
 */
export function toStretch({ kind, min, max }: StretchColumns): StretchSetting {
  switch (kind) {
    case "programs":
      return { kind, count: min };
    case "airtime":
      return { kind, minutes: min };
    case "airtime_range":
      if (max === null) throw new Error("An airtime range has no maximum");
      return { kind, minMinutes: min, maxMinutes: max };
  }
}

/** Writes a stretch as the columns `toStretch` reads back. */
export function toStretchColumns(stretch: StretchSetting): StretchColumns {
  switch (stretch.kind) {
    case "programs":
      return { kind: stretch.kind, min: stretch.count, max: null };
    case "airtime":
      return { kind: stretch.kind, min: stretch.minutes, max: null };
    case "airtime_range":
      return {
        kind: stretch.kind,
        min: stretch.minMinutes,
        max: stretch.maxMinutes,
      };
  }
}

// Starts a read of the item columns and metadata a ScheduleMedia needs,
// through the Media Library's join, so scheduling sees the facts it shows.
function selectScheduleMedia(trx: Executor) {
  return selectWithMetadata(trx)
    .select([
      "media_items.id",
      "media_items.title as item_title",
      "media_items.status",
      "media_items.duration_ms",
    ])
    .select(METADATA_COLUMNS);
}

// Narrows a collection member or single item to the facts kraziBrain
// schedules from, so both member kinds hand it the same shape. Ordering
// facts go through effectiveMetadata and effectiveContentIdentity, so a
// correction wins here exactly as it does in the Media Library. An extra is
// never matched as an episode or movie, so it carries none.
function toScheduleMedia(
  row: MetadataColumns & {
    id: string;
    item_title: string;
    status: MediaItemStatus;
    duration_ms: number | null;
  },
): ScheduleMedia {
  const metadata = effectiveMetadata(row);
  const extra = metadata.matchState === "extra";
  return {
    id: row.id,
    title: row.item_title,
    status: row.status,
    durationMs: row.duration_ms,
    seriesTmdbId: extra ? null : effectiveContentIdentity(row).seriesTmdbId,
    seriesName: extra ? null : metadata.seriesName,
    seasonNumber: extra ? null : metadata.seasonNumber,
    episodeNumber: extra ? null : metadata.episodeNumber,
    releaseDate: extra ? null : metadata.releaseDate,
  };
}

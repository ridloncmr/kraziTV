import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ProgrammingAssignmentMemberTable } from "../../database/schema/programming-assignment-member-table.js";
import type { ProgrammingSourceAssignmentTable } from "../../database/schema/programming-source-assignment-table.js";
import { collectionExists } from "../../media-collections/persistence/collection-rows.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import type {
  MemberAssignedResult,
  MemberSource,
  UnknownMemberResult,
} from "../contracts.js";

// The member rows of programming source assignments: written in saved
// order, decoded, and checked before an assignment write. Every function
// takes the caller's executor, the write's immediate transaction.

type Executor = Kysely<DatabaseSchema>;

// Inserts an assignment's members in saved order, replacing none.
export async function writeMembers(
  trx: Executor,
  assignment: Pick<
    Selectable<ProgrammingSourceAssignmentTable>,
    "id" | "channel_id"
  >,
  members: readonly MemberSource[],
  now: number,
): Promise<void> {
  await trx
    .insertInto("programming_assignment_members")
    .values(
      members.map((member, position) => ({
        assignment_id: assignment.id,
        channel_id: assignment.channel_id,
        position,
        ...(member.kind === "collection"
          ? {
              source_kind: "collection" as const,
              media_collection_id: member.mediaCollectionId,
              media_item_id: null,
            }
          : {
              source_kind: "media_item" as const,
              media_collection_id: null,
              media_item_id: member.mediaItemId,
            }),
        created_at: now,
      })),
    )
    .execute();
}

// Decodes one member row; the table check makes a mismatch corruption.
export function toMemberSource(
  row: Selectable<ProgrammingAssignmentMemberTable>,
): MemberSource {
  if (row.media_collection_id !== null) {
    return { kind: "collection", mediaCollectionId: row.media_collection_id };
  }
  if (row.media_item_id !== null) {
    return { kind: "media_item", mediaItemId: row.media_item_id };
  }
  throw new Error(`Assignment ${row.assignment_id} has a malformed member`);
}

// Reports the first member another assignment on the channel already
// plays; the per-channel unique indexes remain the final guard.
export async function findMemberAssigned(
  executor: Executor,
  channelId: string,
  members: readonly MemberSource[],
  exceptAssignmentId?: string,
): Promise<MemberAssignedResult | undefined> {
  for (const member of members) {
    let query = executor
      .selectFrom("programming_assignment_members")
      .select("assignment_id")
      .where("channel_id", "=", channelId)
      .where(
        member.kind === "collection" ? "media_collection_id" : "media_item_id",
        "=",
        member.kind === "collection"
          ? member.mediaCollectionId
          : member.mediaItemId,
      );
    if (exceptAssignmentId !== undefined) {
      query = query.where("assignment_id", "!=", exceptAssignmentId);
    }
    const row = await query.executeTakeFirst();
    if (row !== undefined) {
      return {
        kind: "member_assigned",
        member,
        assignmentId: row.assignment_id,
      };
    }
  }
  return undefined;
}

// Reports the first member the catalog does not hold; the foreign keys remain the final guard.
export async function findUnknownMember(
  executor: Executor,
  members: readonly MemberSource[],
): Promise<UnknownMemberResult | undefined> {
  for (const member of members) {
    if (member.kind === "collection") {
      if (!(await collectionExists(executor, member.mediaCollectionId))) {
        return {
          kind: "unknown_collection",
          mediaCollectionId: member.mediaCollectionId,
        };
      }
    } else if (
      (await findUnknownMediaItemIds(executor, [member.mediaItemId])).length > 0
    ) {
      return { kind: "unknown_media_item", mediaItemId: member.mediaItemId };
    }
  }
  return undefined;
}

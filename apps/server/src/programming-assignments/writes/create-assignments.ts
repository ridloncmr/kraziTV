import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { AssignmentRepository } from "../persistence/assignment-repository.js";
import type {
  AssignmentSettings,
  MemberRepeatedResult,
  MemberSource,
  SourceAssignment,
} from "../contracts.js";
import { BatchCreateRefusedError } from "./batch-create-refused-error.js";

/**
 * Creates several assignments for one channel, all or nothing, inside the
 * caller's schedule input change, so the batch regenerates and advances
 * the revisions once. Each appends to saved order in request order. The
 * first refusal throws `BatchCreateRefusedError`, rolling back every
 * assignment the batch already wrote.
 */
export async function createAssignments(
  assignments: AssignmentRepository,
  trx: Kysely<DatabaseSchema>,
  channelId: string,
  settings: readonly AssignmentSettings[],
  now: number,
): Promise<{ kind: "created"; assignments: SourceAssignment[] }> {
  // Checked before any write: once an earlier assignment is written, create
  // would name its soon rolled-back ID instead of its request index.
  const repeated = findRepeatedMember(settings);
  if (repeated !== undefined) {
    throw new BatchCreateRefusedError(repeated.index, repeated.refusal);
  }
  const created: SourceAssignment[] = [];
  for (const [index, entry] of settings.entries()) {
    const result = await assignments.create(trx, channelId, entry, now);
    if (result.kind !== "created") {
      throw new BatchCreateRefusedError(index, result);
    }
    created.push(result.assignment);
  }
  return { kind: "created", assignments: created };
}

// Finds the first assignment playing a member an earlier one in the request plays.
function findRepeatedMember(
  settings: readonly AssignmentSettings[],
): { index: number; refusal: MemberRepeatedResult } | undefined {
  const firstIndex = new Map<string, number>();
  for (const [index, entry] of settings.entries()) {
    for (const member of entry.members) {
      const earlier = firstIndex.get(memberKey(member));
      if (earlier !== undefined && earlier !== index) {
        return {
          index,
          refusal: {
            kind: "member_repeated",
            member,
            assignmentIndex: earlier,
          },
        };
      }
      firstIndex.set(memberKey(member), index);
    }
  }
  return undefined;
}

// Identifies a member by kind and ID, whatever its field order.
function memberKey(member: MemberSource): string {
  return member.kind === "collection"
    ? `collection:${member.mediaCollectionId}`
    : `media_item:${member.mediaItemId}`;
}

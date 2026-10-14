import { randomUUID } from "node:crypto";

import type { StretchSetting } from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ProgrammingAssignmentMemberTable } from "../database/schema/programming-assignment-member-table.js";
import type { ProgrammingSourceAssignmentTable } from "../database/schema/programming-source-assignment-table.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import { collectionExists } from "../media-collections/persistence/media-collection-repository.js";
import { findUnknownMediaItemIds } from "../media-items/media-item-repository.js";
import type {
  AssignmentSettings,
  CreateAssignmentResult,
  DeleteAssignmentResult,
  MemberSource,
  SourceAssignment,
  UnknownMemberResult,
  UpdateAssignmentResult,
} from "./contracts.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Persists programming source assignments and their members. Writes take
 * the caller's pinned executor because they run only inside a schedule
 * input change, whose regeneration must commit in the same immediate
 * transaction. Callers supply `now` for the same reason: the transaction's
 * effective time, not a fresh clock read.
 */
export class AssignmentRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;

  // The ID source is injectable so tests can assert exact IDs.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: Pick<RecordSources, "createId"> = {},
  ) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
  }

  /** Lists a channel's assignments in saved order; an unknown channel simply has none. */
  async listForChannel(channelId: string): Promise<SourceAssignment[]> {
    const rows = await this.#db
      .selectFrom("programming_source_assignments")
      .selectAll()
      .where("channel_id", "=", channelId)
      .orderBy("assignment_order")
      .orderBy("id")
      .execute();
    const assignments: SourceAssignment[] = [];
    for (const row of rows) {
      assignments.push(await readAssignment(this.#db, row));
    }
    return assignments;
  }

  /**
   * Adds an assignment after the channel's others. A channel holds one
   * assignment until rotation across several arrives; the check shares the
   * write's immediate transaction, so no concurrent create can race it.
   */
  async create(
    trx: Executor,
    channelId: string,
    settings: AssignmentSettings,
    now: number,
  ): Promise<CreateAssignmentResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) return { kind: "channel_not_found" };
    const unknown = await findUnknownMember(trx, settings.members);
    if (unknown !== undefined) return unknown;
    const existing = await trx
      .selectFrom("programming_source_assignments")
      .select("id")
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    if (existing !== undefined) return { kind: "limit_reached" };

    const row = await trx
      .insertInto("programming_source_assignments")
      .values({
        id: this.#createId(),
        channel_id: channelId,
        assignment_order: 0,
        ...toSettingsColumns(settings),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeMembers(trx, row, settings.members, now);
    return { kind: "created", assignment: await readAssignment(trx, row) };
  }

  /**
   * Replaces an assignment's settings and members; one owned by another
   * channel is not found. Identical settings write nothing and report
   * `unchanged`, so callers can skip regeneration.
   */
  async update(
    trx: Executor,
    channelId: string,
    assignmentId: string,
    settings: AssignmentSettings,
    now: number,
  ): Promise<UpdateAssignmentResult> {
    const existing = await trx
      .selectFrom("programming_source_assignments")
      .selectAll()
      .where("id", "=", assignmentId)
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    if (existing === undefined) return { kind: "not_found" };
    const current = await readAssignment(trx, existing);
    if (isSameSettings(current, settings)) {
      return { kind: "unchanged", assignment: current };
    }
    const unknown = await findUnknownMember(trx, settings.members);
    if (unknown !== undefined) return unknown;

    const row = await trx
      .updateTable("programming_source_assignments")
      .set({ ...toSettingsColumns(settings), updated_at: now })
      .where("id", "=", assignmentId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .deleteFrom("programming_assignment_members")
      .where("assignment_id", "=", assignmentId)
      .execute();
    await writeMembers(trx, row, settings.members, now);
    return { kind: "updated", assignment: await readAssignment(trx, row) };
  }

  /** Removes an assignment and its members; one owned by another channel is not found. */
  async delete(
    trx: Executor,
    channelId: string,
    assignmentId: string,
  ): Promise<DeleteAssignmentResult> {
    const result = await trx
      .deleteFrom("programming_source_assignments")
      .where("id", "=", assignmentId)
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n
      ? { kind: "deleted" }
      : { kind: "not_found" };
  }
}

/**
 * Reads an assignment's ordinary stretch from its columns. The only
 * decoder of stored stretches, so every reader agrees on what a valid row
 * is; only program counts are written so far, so any other kind is
 * corruption.
 */
export function toOrdinaryStretch(
  row: Pick<
    ProgrammingSourceAssignmentTable,
    "id" | "ordinary_kind" | "ordinary_min"
  >,
): StretchSetting {
  if (row.ordinary_kind !== "programs") {
    throw new Error(`Assignment ${row.id} has an unsupported stretch`);
  }
  return { kind: "programs", count: row.ordinary_min };
}

// Inserts an assignment's members in saved order, replacing none.
async function writeMembers(
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

// Reads an assignment row with its members into the shape the API uses.
async function readAssignment(
  executor: Executor,
  row: Selectable<ProgrammingSourceAssignmentTable>,
): Promise<SourceAssignment> {
  const members = await executor
    .selectFrom("programming_assignment_members")
    .selectAll()
    .where("assignment_id", "=", row.id)
    .orderBy("position")
    .execute();
  return {
    id: row.id,
    channelId: row.channel_id,
    playbackMode: row.playback_mode,
    ordinaryStretch: toOrdinaryStretch(row),
    members: members.map(toMemberSource),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Decodes one member row; the table check makes a mismatch corruption.
function toMemberSource(
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

// Flattens the settings into the assignment's own columns.
function toSettingsColumns(settings: AssignmentSettings) {
  return {
    playback_mode: settings.playbackMode,
    ordinary_kind: settings.ordinaryStretch.kind,
    ordinary_min: settings.ordinaryStretch.count,
    ordinary_max: null,
  };
}

// Compares settings by value, so field order never matters.
function isSameSettings(
  current: AssignmentSettings,
  next: AssignmentSettings,
): boolean {
  const normalized = (settings: AssignmentSettings) =>
    JSON.stringify([
      toSettingsColumns(settings),
      settings.members.map((member) =>
        member.kind === "collection"
          ? ["collection", member.mediaCollectionId]
          : ["media_item", member.mediaItemId],
      ),
    ]);
  return normalized(current) === normalized(next);
}

// Reports the first member the catalog does not hold; the foreign keys remain the final guard.
async function findUnknownMember(
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

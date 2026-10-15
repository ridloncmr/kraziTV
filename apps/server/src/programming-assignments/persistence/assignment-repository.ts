import { randomUUID } from "node:crypto";

import {
  isSchedulableMedia,
  type MarathonSettings,
  type StretchSetting,
} from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ProgrammingSourceAssignmentTable } from "../../database/schema/programming-source-assignment-table.js";
import type { RecordSources } from "../../database/writes/record-sources.js";
import {
  findMemberAssigned,
  findUnknownMember,
  toMemberSource,
  writeMembers,
} from "./assignment-members.js";
import { endStartedTurn } from "../../schedules/persistence/generated-blocks.js";
import {
  loadMarathonSettings,
  toAssignmentStretches,
  toStretchColumns,
} from "../../schedules/persistence/assignment-sources.js";
import type {
  AssignmentSettings,
  CreateAssignmentResult,
  DeleteAssignmentResult,
  MemberSource,
  ReorderAssignmentsResult,
  SaveMarathonSettingsResult,
  SourceAssignment,
  UpdateAssignmentResult,
} from "../contracts.js";

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

  /** Reads a channel's marathon chance and cooldown, or the defaults when it saved none. */
  async readMarathonSettings(channelId: string): Promise<MarathonSettings> {
    return loadMarathonSettings(this.#db, channelId);
  }

  /**
   * Saves a channel's marathon chance and cooldown. The same values write
   * nothing and report `unchanged`, so callers can skip regeneration.
   */
  async saveMarathonSettings(
    trx: Executor,
    channelId: string,
    settings: MarathonSettings,
    now: number,
  ): Promise<SaveMarathonSettingsResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) return { kind: "channel_not_found" };
    const current = await loadMarathonSettings(trx, channelId);
    if (
      current.chancePercent === settings.chancePercent &&
      current.minOrdinaryRounds === settings.minOrdinaryRounds
    ) {
      return { kind: "unchanged", settings: current };
    }
    const columns = {
      marathon_chance_percent: settings.chancePercent,
      marathon_min_ordinary_rounds: settings.minOrdinaryRounds,
      updated_at: now,
    };
    await trx
      .insertInto("channel_programming_settings")
      .values({ channel_id: channelId, ...columns, created_at: now })
      .onConflict((conflict) =>
        conflict.column("channel_id").doUpdateSet(columns),
      )
      .execute();
    return { kind: "saved", settings };
  }

  /**
   * Suggests an ordinary stretch for new members (programming spec 0004):
   * one program when every schedulable member is a movie, three when every
   * one is an episode, and null otherwise, including when nothing is
   * schedulable, so the editor asks. An editable setup default, never a
   * scheduling rule.
   */
  async suggestStretch(
    members: readonly MemberSource[],
  ): Promise<StretchSetting | null> {
    const collectionIds = members.flatMap((member) =>
      member.kind === "collection" ? [member.mediaCollectionId] : [],
    );
    const itemIds = members.flatMap((member) =>
      member.kind === "media_item" ? [member.mediaItemId] : [],
    );
    const rows = await this.#db
      .selectFrom("media_items")
      .leftJoin(
        "content_facts",
        "content_facts.media_item_id",
        "media_items.id",
      )
      .select([
        "media_items.status",
        "media_items.duration_ms",
        "content_facts.content_type",
      ])
      // SQLite refuses an empty IN list, so each kind joins only when present.
      .where((eb) =>
        eb.or([
          ...(itemIds.length > 0 ? [eb("media_items.id", "in", itemIds)] : []),
          ...(collectionIds.length > 0
            ? [
                eb(
                  "media_items.id",
                  "in",
                  eb
                    .selectFrom("media_collection_items")
                    .select("media_item_id")
                    .where("media_collection_id", "in", collectionIds),
                ),
              ]
            : []),
        ]),
      )
      .execute();
    const types = new Set(
      rows
        .filter((row) =>
          isSchedulableMedia({
            status: row.status,
            durationMs: row.duration_ms,
          }),
        )
        .map((row) => row.content_type ?? "unknown"),
    );
    if (types.size !== 1) return null;
    if (types.has("movie")) return { kind: "programs", count: 1 };
    if (types.has("episode")) return { kind: "programs", count: 3 };
    return null;
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
   * Adds an assignment after the channel's others in saved order. A member
   * another assignment on the channel plays is refused; the check shares the
   * write's immediate transaction, so no concurrent write can race it.
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
    const refused =
      (await findUnknownMember(trx, settings.members)) ??
      (await findMemberAssigned(trx, channelId, settings.members));
    if (refused !== undefined) return refused;
    const last = await trx
      .selectFrom("programming_source_assignments")
      .select((eb) => eb.fn.max("assignment_order").as("order"))
      .where("channel_id", "=", channelId)
      .executeTakeFirst();

    const row = await trx
      .insertInto("programming_source_assignments")
      .values({
        id: this.#createId(),
        channel_id: channelId,
        assignment_order: (last?.order ?? -1) + 1,
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
    const refused =
      (await findUnknownMember(trx, settings.members)) ??
      (await findMemberAssigned(
        trx,
        channelId,
        settings.members,
        assignmentId,
      ));
    if (refused !== undefined) return refused;

    // A mode or stretch change ends the started turn after the airing
    // program; member edits keep it (programming spec 0004).
    const columns = toSettingsColumns(settings);
    if (
      JSON.stringify(columns) !== JSON.stringify(toSettingsColumns(current))
    ) {
      await endStartedTurn(trx, channelId, assignmentId, now);
    }
    const row = await trx
      .updateTable("programming_source_assignments")
      .set({ ...columns, updated_at: now })
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

  /**
   * Saves a new assignment order for the channel. It affects how future
   * rounds are formed; the current round's pending turns stand. The same
   * order writes nothing and reports `unchanged`, so callers can skip
   * regeneration.
   */
  async reorder(
    trx: Executor,
    channelId: string,
    assignmentIds: readonly string[],
    now: number,
  ): Promise<ReorderAssignmentsResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) return { kind: "channel_not_found" };
    const rows = await trx
      .selectFrom("programming_source_assignments")
      .selectAll()
      .where("channel_id", "=", channelId)
      .orderBy("assignment_order")
      .orderBy("id")
      .execute();
    const current = rows.map((row) => row.id);
    if (
      new Set(assignmentIds).size !== assignmentIds.length ||
      [...assignmentIds].sort().join() !== [...current].sort().join()
    ) {
      return { kind: "mismatch", assignmentIds: current };
    }
    const changed = assignmentIds.join() !== current.join();
    if (changed) {
      for (const [order, id] of assignmentIds.entries()) {
        await trx
          .updateTable("programming_source_assignments")
          .set({ assignment_order: order, updated_at: now })
          .where("id", "=", id)
          .execute();
      }
    }
    const assignments: SourceAssignment[] = [];
    for (const id of assignmentIds) {
      const row = await trx
        .selectFrom("programming_source_assignments")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      assignments.push(await readAssignment(trx, row));
    }
    return { kind: changed ? "reordered" : "unchanged", assignments };
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
    ...toApiStretches(row),
    members: members.map(toMemberSource),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Flattens the settings into the assignment's own columns.
function toSettingsColumns(settings: AssignmentSettings) {
  const ordinary = toStretchColumns(settings.ordinaryStretch);
  const marathon =
    settings.marathonStretch === null
      ? null
      : toStretchColumns(settings.marathonStretch);
  return {
    playback_mode: settings.playbackMode,
    ordinary_kind: ordinary.kind,
    ordinary_min: ordinary.min,
    ordinary_max: ordinary.max,
    marathon_kind: marathon?.kind ?? null,
    marathon_min: marathon?.min ?? null,
    marathon_max: marathon?.max ?? null,
  };
}

// Names the stored stretches as the API does.
function toApiStretches(row: Selectable<ProgrammingSourceAssignmentTable>) {
  const { ordinary, marathon } = toAssignmentStretches(row);
  return { ordinaryStretch: ordinary, marathonStretch: marathon };
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

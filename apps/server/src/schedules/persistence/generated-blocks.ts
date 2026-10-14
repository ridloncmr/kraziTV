import type {
  BlockSource,
  GeneratedBlock,
  LatestTurn,
  RotationCheckpoint,
} from "@krazitv/krazi-brain";
import type { Kysely, Selectable } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ProgrammingBlockTable } from "../../database/schema/programming-block-table.js";

// Every function here takes the caller's executor: blocks are written only
// inside the schedule transaction that writes their entries.

type Executor = Kysely<DatabaseSchema>;

/**
 * Loads the channel's latest kept block with how much of its turn the kept
 * entries aired, so generation can continue that turn or advance the
 * rotation past it. Undefined before the channel's first turn.
 */
export async function loadLatestTurn(
  trx: Executor,
  channelId: string,
): Promise<LatestTurn | undefined> {
  const row = await trx
    .selectFrom("programming_blocks")
    .selectAll()
    .where("channel_id", "=", channelId)
    .orderBy("starts_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const aired = await trx
    .selectFrom("schedule_entries")
    .select((eb) => [
      eb.fn.countAll<number>().as("programs"),
      eb.fn.coalesce(eb.fn.sum<number>("duration_ms"), eb.lit(0)).as("ms"),
    ])
    .where("programming_block_id", "=", row.id)
    .executeTakeFirstOrThrow();
  return {
    block: toGeneratedBlock(row),
    airedPrograms: Number(aired.programs),
    airedMs: Number(aired.ms),
  };
}

/** Inserts the blocks one chunk generated, before the entries that reference them. */
export async function insertBlocks(
  trx: Executor,
  channelId: string,
  blocks: readonly GeneratedBlock[],
  now: number,
): Promise<void> {
  if (blocks.length === 0) return;
  await trx
    .insertInto("programming_blocks")
    .values(
      blocks.map((block) => ({
        id: block.id,
        channel_id: channelId,
        assignment_id: block.assignmentId,
        ...toSourceColumns(block.source),
        round_number: block.roundNumber,
        turn_index: block.turnIndex,
        starts_at: block.startsAt,
        resolved_kind: block.size?.kind ?? null,
        resolved_value: block.size?.value ?? null,
        marathon: toSqliteBoolean(block.marathon),
        checkpoint: JSON.stringify(block.checkpoint),
        created_at: now,
        updated_at: now,
      })),
    )
    .execute();
}

/**
 * Deletes the channel's blocks that no entry holds any more, after
 * regeneration deleted their entries. The block holding a kept entry stays,
 * so its turn continues and its checkpoint restores the rotation.
 */
export async function deleteEmptyBlocks(
  trx: Executor,
  channelId: string,
): Promise<void> {
  await trx
    .deleteFrom("programming_blocks")
    .where("channel_id", "=", channelId)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("schedule_entries")
            .select("schedule_entries.id")
            .whereRef(
              "schedule_entries.programming_block_id",
              "=",
              "programming_blocks.id",
            ),
        ),
      ),
    )
    .execute();
}

// Flattens a block's member into the columns the table check expects; a
// generated block always has its source.
function toSourceColumns(source: BlockSource | null) {
  if (source === null) {
    throw new Error("a generated block must name the member that took it");
  }
  return source.kind === "collection"
    ? {
        source_kind: "collection" as const,
        media_collection_id: source.mediaCollectionId,
        media_item_id: null,
        playback_mode: source.playbackMode,
      }
    : {
        source_kind: "media_item" as const,
        media_collection_id: null,
        media_item_id: source.mediaItemId,
        playback_mode: null,
      };
}

// Reads a block row back, with a deleted source as null.
function toGeneratedBlock(
  row: Selectable<ProgrammingBlockTable>,
): GeneratedBlock {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    source: toBlockSource(row),
    roundNumber: row.round_number,
    turnIndex: row.turn_index,
    startsAt: row.starts_at,
    size:
      row.resolved_kind === null || row.resolved_value === null
        ? null
        : { kind: row.resolved_kind, value: row.resolved_value },
    marathon: fromSqliteBoolean(row.marathon),
    checkpoint: JSON.parse(row.checkpoint) as RotationCheckpoint,
  };
}

// Rebuilds a block's member, or null once its collection or item is deleted.
function toBlockSource(
  row: Selectable<ProgrammingBlockTable>,
): BlockSource | null {
  if (
    row.source_kind === "collection" &&
    row.media_collection_id !== null &&
    row.playback_mode !== null
  ) {
    return {
      kind: "collection",
      mediaCollectionId: row.media_collection_id,
      playbackMode: row.playback_mode,
    };
  }
  if (row.source_kind === "media_item" && row.media_item_id !== null) {
    return { kind: "media_item", mediaItemId: row.media_item_id };
  }
  return null;
}

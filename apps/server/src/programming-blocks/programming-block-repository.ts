import { randomUUID } from "node:crypto";

import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { ProgrammingBlockTable } from "../database/schema/programming-block-table.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import { isUniqueViolation } from "../database/writes/unique-violation.js";
import {
  collectionExists,
  findUnknownMediaItemIds,
} from "../media-collections/media-collection-repository.js";
import type {
  CreateProgrammingBlockResult,
  DeleteProgrammingBlockResult,
  ProgrammingBlock,
  ProgrammingBlockSource,
  ReplaceProgrammingBlockSourceResult,
} from "./contracts.js";

type SourceColumns = Pick<
  ProgrammingBlockTable,
  "source_kind" | "media_collection_id" | "media_item_id" | "playback_mode"
>;

type UnknownSource = Exclude<
  CreateProgrammingBlockResult,
  { kind: "created" | "limit_reached" | "channel_not_found" }
>;

/**
 * Persists programming blocks. Writes take the caller's pinned executor
 * because they run only inside a schedule input change, whose regeneration
 * must commit in the same immediate transaction. Callers supply `now` for the
 * same reason: the transaction's effective time, not a fresh clock read.
 */
export class ProgrammingBlockRepository {
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

  /** Lists a channel's blocks oldest first; an unknown channel simply has none. */
  async listForChannel(channelId: string): Promise<ProgrammingBlock[]> {
    const rows = await this.#db
      .selectFrom("programming_blocks")
      .selectAll()
      .where("channel_id", "=", channelId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    return rows.map(toProgrammingBlock);
  }

  /**
   * Adds a block to a channel. The unique index alone enforces the one-block
   * limit, so no precheck can race it; the statement fails without aborting
   * the caller's transaction.
   */
  async create(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    source: ProgrammingBlockSource,
    now: number,
  ): Promise<CreateProgrammingBlockResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) {
      return { kind: "channel_not_found" };
    }
    const unknown = await findUnknownSource(trx, source);
    if (unknown !== undefined) {
      return unknown;
    }

    try {
      const row = await trx
        .insertInto("programming_blocks")
        .values({
          id: this.#createId(),
          channel_id: channelId,
          ...toSourceColumns(source),
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { kind: "created", block: toProgrammingBlock(row) };
    } catch (error) {
      if (isUniqueViolation(error, "programming_blocks.channel_id")) {
        return { kind: "limit_reached" };
      }
      throw error;
    }
  }

  /**
   * Swaps a block's source; a block owned by another channel is not found.
   * An identical source writes nothing and reports `unchanged`, so callers
   * can skip regeneration.
   */
  async replaceSource(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    blockId: string,
    source: ProgrammingBlockSource,
    now: number,
  ): Promise<ReplaceProgrammingBlockSourceResult> {
    const existing = await trx
      .selectFrom("programming_blocks")
      .selectAll()
      .where("id", "=", blockId)
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    if (existing === undefined) {
      return { kind: "not_found" };
    }
    const block = toProgrammingBlock(existing);
    if (isSameSource(block.source, source)) {
      return { kind: "unchanged", block };
    }
    const unknown = await findUnknownSource(trx, source);
    if (unknown !== undefined) {
      return unknown;
    }

    const row = await trx
      .updateTable("programming_blocks")
      .set({ ...toSourceColumns(source), updated_at: now })
      .where("id", "=", blockId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { kind: "replaced", block: toProgrammingBlock(row) };
  }

  /** Removes a block; a block owned by another channel is not found. */
  async delete(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    blockId: string,
  ): Promise<DeleteProgrammingBlockResult> {
    const result = await trx
      .deleteFrom("programming_blocks")
      .where("id", "=", blockId)
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n
      ? { kind: "deleted" }
      : { kind: "not_found" };
  }
}

// Compares sources by the columns they persist to, so field order never matters.
function isSameSource(
  a: ProgrammingBlockSource,
  b: ProgrammingBlockSource,
): boolean {
  const left = toSourceColumns(a);
  const right = toSourceColumns(b);
  return (
    left.source_kind === right.source_kind &&
    left.media_collection_id === right.media_collection_id &&
    left.media_item_id === right.media_item_id &&
    left.playback_mode === right.playback_mode
  );
}

// Reports a source the catalog does not hold; the foreign keys remain the final guard.
async function findUnknownSource(
  executor: Kysely<DatabaseSchema>,
  source: ProgrammingBlockSource,
): Promise<UnknownSource | undefined> {
  if (source.kind === "collection") {
    return (await collectionExists(executor, source.mediaCollectionId))
      ? undefined
      : {
          kind: "unknown_collection",
          mediaCollectionId: source.mediaCollectionId,
        };
  }
  const unknown = await findUnknownMediaItemIds(executor, [source.mediaItemId]);
  return unknown.length === 0
    ? undefined
    : { kind: "unknown_media_item", mediaItemId: source.mediaItemId };
}

// Flattens the discriminated source into the columns the table check expects.
function toSourceColumns(source: ProgrammingBlockSource): SourceColumns {
  return source.kind === "collection"
    ? {
        source_kind: "collection",
        media_collection_id: source.mediaCollectionId,
        media_item_id: null,
        playback_mode: source.playbackMode,
      }
    : {
        source_kind: "media_item",
        media_collection_id: null,
        media_item_id: source.mediaItemId,
        playback_mode: null,
      };
}

// Rebuilds the discriminated source; the table check makes a mismatch corruption.
function toProgrammingBlock(
  row: Selectable<ProgrammingBlockTable>,
): ProgrammingBlock {
  return {
    id: row.id,
    channelId: row.channel_id,
    source: toSource(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Reads the source columns back into the shape callers and the API use.
function toSource(
  row: Selectable<ProgrammingBlockTable>,
): ProgrammingBlockSource {
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
  throw new Error(`Programming block ${row.id} has a malformed source`);
}

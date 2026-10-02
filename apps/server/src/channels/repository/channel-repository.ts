import { randomUUID } from "node:crypto";

import type { Kysely, Selectable } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { ChannelTable } from "../../database/schema/channel-table.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { RecordSources } from "../../database/writes/record-sources.js";
import { isUniqueViolation } from "../../database/writes/unique-violation.js";
import {
  compareChannelNumbers,
  parseChannelNumber,
} from "../channel-number.js";
import type {
  ChannelChanges,
  CreateChannelInput,
  CreateChannelResult,
  StoredChannel,
  UpdateChannelResult,
} from "../contracts.js";

/**
 * Persists channel identity. The unique number constraint is the only duplicate
 * guard, so a concurrent create or renumber can never slip past a precheck.
 */
export class ChannelRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;

  // Clock and ID sources are injectable so tests can assert exact timestamps and IDs.
  constructor(db: Kysely<DatabaseSchema>, options: RecordSources = {}) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  /** Inserts a channel, or reports that another channel already holds its number. */
  async create(input: CreateChannelInput): Promise<CreateChannelResult> {
    const now = this.#now();
    try {
      const row = await this.#db
        .insertInto("channels")
        .values({
          id: this.#createId(),
          number: input.number,
          name: input.name,
          enabled: toSqliteBoolean(input.enabled),
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { kind: "created", channel: toStoredChannel(row) };
    } catch (error) {
      if (isUniqueViolation(error, "channels.number")) {
        return { kind: "duplicate_number", number: input.number };
      }
      throw error;
    }
  }

  /**
   * Lists channels in lineup order. Sorted in memory because SQL text order
   * would put `10` before `2`; unique numbers make an ID tie-breaker moot.
   */
  async list(): Promise<StoredChannel[]> {
    const rows = await this.#db.selectFrom("channels").selectAll().execute();
    return rows
      .map(toStoredChannel)
      .sort((a, b) => compareChannelNumbers(a.number, b.number));
  }

  /** Loads one channel; returns undefined when the ID is unknown. */
  async findById(id: string): Promise<StoredChannel | undefined> {
    const row = await this.#db
      .selectFrom("channels")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined ? undefined : toStoredChannel(row);
  }

  /**
   * Applies a partial update. Only values that differ from the stored row are
   * written, so updatedAt advances only on a real change; the read and write
   * share a transaction so the comparison cannot go stale.
   */
  async update(
    id: string,
    changes: ChannelChanges,
  ): Promise<UpdateChannelResult> {
    try {
      return await this.#db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom("channels")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        if (row === undefined) {
          return { kind: "not_found" };
        }

        const current = toStoredChannel(row);
        const changed = {
          ...(changes.number !== undefined &&
            changes.number !== current.number && { number: changes.number }),
          ...(changes.name !== undefined &&
            changes.name !== current.name && { name: changes.name }),
          ...(changes.enabled !== undefined &&
            changes.enabled !== current.enabled && {
              enabled: toSqliteBoolean(changes.enabled),
            }),
        };
        if (Object.keys(changed).length === 0) {
          return { kind: "updated", channel: current };
        }

        const updated = await trx
          .updateTable("channels")
          .set({ ...changed, updated_at: this.#now() })
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return { kind: "updated", channel: toStoredChannel(updated) };
      });
    } catch (error) {
      // Only a number change can collide, so the contested number is always known here.
      if (
        isUniqueViolation(error, "channels.number") &&
        changes.number !== undefined
      ) {
        return { kind: "duplicate_number", number: changes.number };
      }
      throw error;
    }
  }

  /** Deletes a channel; returns whether one existed so callers can stay idempotent. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db
      .deleteFrom("channels")
      .where("id", "=", id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}

// Re-brands the stored number; the check constraint makes a failure here corruption.
function toStoredChannel(row: Selectable<ChannelTable>): StoredChannel {
  const number = parseChannelNumber(row.number);
  if (number === undefined) {
    throw new Error(
      `Channel ${row.id} has non-canonical number ${JSON.stringify(row.number)}`,
    );
  }
  return {
    id: row.id,
    number,
    name: row.name,
    enabled: fromSqliteBoolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

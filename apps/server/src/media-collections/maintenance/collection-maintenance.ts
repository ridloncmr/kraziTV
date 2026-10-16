import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import {
  hasAutomaticCollections,
  hasMetadataOrderedAssignments,
  maintenanceChange,
  orderingChange,
  recordMaintenanceFailure,
} from "./maintenance-writes.js";

interface CollectionMaintenanceOptions {
  db: Kysely<DatabaseSchema>;
  schedules: Pick<ScheduleService, "applyInputChange">;
  /** The process logger; a pass outlives the request that asked for it. */
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  hooks?: {
    /** A test pause point before each pass's transaction begins. */
    beforePass?: (() => Promise<void>) | undefined;
  };
}

/**
 * Keeps every automatic collection's membership equal to what its criterion
 * matches in committed facts, and every episode or release order's schedule
 * equal to the order committed facts give. Fact, tag, catalog, criterion,
 * and exclusion writers only call `request()` after they commit; requests coalesce into
 * one pass at a time, and a request made while a pass runs gets one more
 * pass after it, since the running pass may have read before that commit.
 */
export class CollectionMaintenance {
  readonly #options: CollectionMaintenanceOptions;
  /** Settles the requests waiting for the next pass to start. */
  #waiting: PromiseWithResolvers<void> | undefined;
  #running: Promise<void> | undefined;
  #closed = false;

  // Every collaborator is injected so tests drive the clock and failures.
  constructor(options: CollectionMaintenanceOptions) {
    this.#options = options;
  }

  /**
   * Asks for a pass over every automatic collection. Writers ignore the
   * result; it settles once a pass that started after this call finishes,
   * never rejects, and settles at once after shutdown.
   */
  request(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#waiting ??= Promise.withResolvers<void>();
    const settled = this.#waiting.promise;
    this.#running ??= this.#drain();
    return settled;
  }

  /** Lets a running pass finish and starts no other, so the database can close afterwards. */
  async shutdown(): Promise<void> {
    this.#closed = true;
    await this.#running;
  }

  /** Runs passes while requests wait, then settles any left by shutdown. */
  async #drain(): Promise<void> {
    while (this.#waiting !== undefined && !this.#closed) {
      const batch = this.#waiting;
      this.#waiting = undefined;
      await this.#pass();
      batch.resolve();
    }
    this.#waiting?.resolve();
    this.#waiting = undefined;
    this.#running = undefined;
  }

  /**
   * Runs one pass: automatic membership first, then metadata playback
   * orders, so the order check reads the membership the pass just wrote.
   * Each step is its own schedule input change, logged under its own
   * reason, and one failing never stops the other.
   */
  async #pass(): Promise<void> {
    await this.#maintainCollections();
    await this.#checkOrders();
  }

  /**
   * Reconciles every automatic collection, and logs and records a failure
   * instead of throwing; the next request converges from committed facts.
   */
  async #maintainCollections(): Promise<void> {
    const { db, schedules, log, hooks } = this.#options;
    try {
      await hooks?.beforePass?.();
      if (!(await hasAutomaticCollections(db))) return;
      await schedules.applyInputChange(
        log,
        "collection_maintained",
        maintenanceChange(),
      );
    } catch (error) {
      log.error({ err: error }, "Collection maintenance failed");
      try {
        await recordMaintenanceFailure(
          db,
          error instanceof Error ? error.message : String(error),
        );
      } catch (recordError) {
        log.error(
          { err: recordError },
          "Could not record the collection maintenance failure",
        );
      }
    }
  }

  /**
   * Regenerates channels whose episode or release order the committed facts
   * changed, and logs a failure instead of throwing; the next request
   * compares again from committed facts.
   */
  async #checkOrders(): Promise<void> {
    const { db, schedules, log } = this.#options;
    try {
      if (!(await hasMetadataOrderedAssignments(db))) return;
      await schedules.applyInputChange(
        log,
        "ordering_changed",
        orderingChange(),
      );
    } catch (error) {
      log.error({ err: error }, "Checking metadata playback orders failed");
    }
  }
}

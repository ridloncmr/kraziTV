import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { runImmediateTransaction } from "../database/writes/immediate-transaction.js";
import type { ScheduleLog } from "../schedules/contracts.js";
import { effectiveNow } from "../schedules/schedule-coverage.js";
import { findLatestScheduleMutation } from "../schedules/schedule-repository.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import type {
  CatalogRemoval,
  CatalogRemovalImpact,
  CatalogRemovalOutcome,
  CatalogRemovalRefusal,
  CatalogRemovalRequest,
  CatalogRemovalTarget,
  ImpactRead,
  RemovedPathReclaim,
} from "./contracts.js";
import { readRemovalImpact } from "./impact/removal-impact.js";
import { purgeRemovedMedia } from "./purge/purge-removed-media.js";
import { removeFromCatalog } from "./writes/remove-from-catalog.js";

interface CatalogRemovalServiceOptions {
  schedules: ScheduleService;
  /** Whether a root has a scan job that has not finished; read from the scanner's memory. */
  isScanning: (rootId: string) => boolean;
}

/**
 * Removes media from the catalog as one schedule input change: the impact
 * check, the catalog writes, every affected channel's regeneration, and the
 * purge commit together or not at all. The preview runs the same impact read
 * without writing.
 */
export class CatalogRemovalService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #schedules: ScheduleService;
  readonly #isScanning: (rootId: string) => boolean;

  // The scan check is a function so this domain never depends on how scans run.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: CatalogRemovalServiceOptions,
  ) {
    this.#db = db;
    this.#schedules = options.schedules;
    this.#isScanning = options.isScanning;
  }

  /**
   * Reports what removing `target` now would do, or its refusal, in one
   * deferred snapshot that never writes. Evaluated at the time a removal
   * would use: the schedule clock, never earlier than the last mutation.
   */
  async preview(target: CatalogRemovalTarget): Promise<ImpactRead> {
    return this.#db.transaction().execute(async (trx) => {
      const now = effectiveNow(
        this.#schedules.now(),
        await findLatestScheduleMutation(trx),
      );
      return readRemovalImpact(trx, target, now, this.#isScanning);
    });
  }

  /**
   * Purges removed media whose airing has ended, for the triggers outside a
   * removal: after a scan commits and at startup. Takes write authority
   * only when removed rows exist, so a catalog without removals pays one
   * read. Never throws; a failure is logged and the next trigger retries, as
   * nothing waits on it.
   */
  async purge(log: Pick<ScheduleLog, "warn">): Promise<void> {
    try {
      const waiting = await this.#db
        .selectFrom("media_items")
        .select("id")
        .where("removed_at", "is not", null)
        .union(
          this.#db
            .selectFrom("media_roots")
            .select("id")
            .where("removed_at", "is not", null),
        )
        .limit(1)
        .executeTakeFirst();
      if (waiting === undefined) return;
      await runImmediateTransaction(this.#db, (trx) =>
        purgeRemovedMedia(trx, this.#schedules.now()),
      );
    } catch (err) {
      log.warn({ err }, "Purging removed media failed");
    }
  }

  /**
   * Frees a path that a removed root still holds, so a new root can take it:
   * purges first, then reports whether the old root is gone or until when an
   * airing entry holds one of its items. Throws when write authority stays
   * busy, because the caller is waiting on the answer.
   */
  async reclaimRemovedPath(pathKey: string): Promise<RemovedPathReclaim> {
    return runImmediateTransaction(this.#db, async (trx) => {
      const removedRoot = () =>
        trx
          .selectFrom("media_roots")
          .select("id")
          .where("path_key", "=", pathKey)
          .where("removed_at", "is not", null)
          .executeTakeFirst();
      if ((await removedRoot()) === undefined) return { kind: "not_removed" };

      const now = this.#schedules.now();
      await purgeRemovedMedia(trx, now);
      const root = await removedRoot();
      if (root === undefined) return { kind: "reclaimed" };
      const { airingUntil } = await trx
        .selectFrom("schedule_entries")
        .innerJoin(
          "media_items",
          "media_items.id",
          "schedule_entries.media_item_id",
        )
        .select((eb) => eb.fn.max("schedule_entries.ends_at").as("airingUntil"))
        .where("media_items.media_root_id", "=", root.id)
        .executeTakeFirstOrThrow();
      return { kind: "removal_pending", airingUntil: airingUntil ?? now };
    });
  }

  /**
   * Removes the request's target, or returns the first refusal having written
   * nothing. Runs at the input change's effective time, so the impact, the
   * removal times, regeneration, and purge all agree on what is airing. With
   * `interrupt`, each channel airing removed media is rebuilt from now
   * instead of finishing; its worker is the caller's to stop after the commit.
   */
  async remove(
    request: CatalogRemovalRequest,
    log: ScheduleLog,
  ): Promise<CatalogRemovalOutcome> {
    return this.#schedules.applyInputChange<CatalogRemovalOutcome>(
      log,
      "media_removed",
      async (trx, effectiveNow) => {
        const checked = checkRemoval(
          await readRemovalImpact(
            trx,
            request.target,
            effectiveNow,
            this.#isScanning,
          ),
          request,
        );
        if (checked.kind !== "impact") {
          return { value: checked, affectedChannelIds: [] };
        }

        const { impact } = checked;
        const removal = toRemoval(impact, request.airing);
        await removeFromCatalog(trx, request.target, effectiveNow);
        return {
          value: { kind: "removed", removal },
          affectedChannelIds: impact.affectedChannelIds,
          interruptedChannelIds: removal.interruptedChannelIds,
          // After an interrupt nothing holds the removed items, so this
          // purge takes them at once.
          afterRegeneration: (trx, advanced) =>
            purgeRemovedMedia(trx, effectiveNow, advanced),
        };
      },
    );
  }
}

// Passes the impact on, or refuses: the impact read's own refusal first,
// then a removal that would take enabled channels off the air without the
// request's consent.
function checkRemoval(
  read: ImpactRead,
  request: CatalogRemovalRequest,
): ImpactRead | CatalogRemovalRefusal {
  if (read.kind !== "impact") return read;
  if (
    !request.allowUnschedulable &&
    read.impact.channelsLeftUnschedulable.length > 0
  ) {
    return { kind: "channels_left_unschedulable", impact: read.impact };
  }
  return read;
}

// Reports what the removal does to each channel airing removed media: it
// either finishes its program or, by the user's choice, is interrupted.
function toRemoval(
  impact: CatalogRemovalImpact,
  airing: CatalogRemovalRequest["airing"],
): CatalogRemoval {
  const interrupt = airing === "interrupt";
  return {
    removedItemCount: impact.itemCount,
    finishing: interrupt
      ? []
      : impact.airing.map(({ channelId, endsAt }) => ({ channelId, endsAt })),
    interruptedChannelIds: interrupt
      ? impact.airing.map(({ channelId }) => channelId)
      : [],
    affectedChannelIds: impact.affectedChannelIds,
  };
}

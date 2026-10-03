import type {
  TransitionCandidate,
  TransitionCoordinator,
} from "@krazitv/signal";
import { assertPositiveSafeInteger } from "@krazitv/process";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  type ImmediateTransactionHooks,
  runImmediateTransaction,
} from "../../database/writes/immediate-transaction.js";
import { findCoveringPlayoutEntries } from "../../playout/playout-repository.js";
import {
  findChannelEnabled,
  loadScheduleState,
} from "../../schedules/schedule-repository.js";

interface SqliteTransitionCoordinatorOptions {
  /**
   * How long to keep retrying while another connection holds write
   * authority before failing. Composition passes the worker's recovery
   * window: giving up sooner would stop a live channel that could still
   * have committed in time.
   */
  writeAuthorityWaitMs: number;
  /** Passed to every immediate transaction; a test pause point. */
  transactionHooks?: ImmediateTransactionHooks | undefined;
}

// Ramps up quickly so brief contention barely delays the cut, then polls at
// the last delay until the wait is spent.
const RETRY_DELAYS_MS = [5, 10, 20, 40, 50];
const POLL_MS = 50;

/**
 * Gives schedule regeneration and a worker's prepared transition one
 * deterministic winner. It holds the same write authority every schedule
 * mutation takes, so a regeneration either commits before revalidation and
 * makes the candidate stale, or waits until the worker has committed and
 * then sees the new item as the one airing.
 */
export class SqliteTransitionCoordinator implements TransitionCoordinator {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #now: () => number;
  readonly #transactionHooks: ImmediateTransactionHooks | undefined;
  readonly #maxAttempts: number;

  // `now` must be the clock the worker sleeps on, so its boundary and this
  // revalidation agree on what airs.
  constructor(
    db: Kysely<DatabaseSchema>,
    now: () => number,
    options: SqliteTransitionCoordinatorOptions,
  ) {
    // A wait that is not a positive integer would make the attempt count
    // NaN or zero, and the retry loop would never or always give up.
    assertPositiveSafeInteger(
      options.writeAuthorityWaitMs,
      "writeAuthorityWaitMs",
    );
    this.#db = db;
    this.#now = now;
    this.#transactionHooks = options.transactionHooks;
    // The ramp's attempts, plus enough polls to cover the wait.
    this.#maxAttempts =
      RETRY_DELAYS_MS.length +
      Math.ceil(options.writeAuthorityWaitMs / POLL_MS);
  }

  /**
   * Revalidates the candidate and runs `commit` while still holding write
   * authority, so no regeneration can land between the check and the commit.
   * Boundary time is read only after the lock is held, because waiting for
   * it can carry the clock past the boundary. A throw from `commit` rejects
   * unchanged, and the worker treats it as its own failure.
   */
  commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale"> {
    return runImmediateTransaction(
      this.#db,
      async (trx) => {
        if (!(await isStillCurrent(trx, candidate, this.#now()))) {
          return "stale";
        }
        commit();
        return "committed";
      },
      {
        maxAttempts: this.#maxAttempts,
        retryDelaysMs: RETRY_DELAYS_MS,
        hooks: this.#transactionHooks,
      },
    );
  }
}

/**
 * Whether the candidate is still what should air at `boundaryTime`: its
 * channel still exists and is enabled, the schedule revision it was
 * prepared under is still current, and its entry covers `boundaryTime`.
 */
async function isStillCurrent(
  trx: Kysely<DatabaseSchema>,
  candidate: TransitionCandidate,
  boundaryTime: number,
): Promise<boolean> {
  const { channelId } = candidate;
  if ((await findChannelEnabled(trx, channelId)) !== true) return false;
  const state = await loadScheduleState(trx, channelId);
  if (state?.scheduleRevision !== candidate.scheduleRevision) return false;
  const [covering] = await findCoveringPlayoutEntries(
    trx,
    channelId,
    boundaryTime,
  );
  return covering?.id === candidate.scheduleEntryId;
}

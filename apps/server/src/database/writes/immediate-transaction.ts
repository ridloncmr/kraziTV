import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { type Kysely, sql } from "kysely";

/**
 * `afterBegin` runs inside the transaction, so a throw from it rolls back like
 * one from `work`. `onBusy` and `afterRelease` only observe: a throw from
 * either is reported as a process warning and never changes the outcome.
 */
export interface ImmediateTransactionHooks {
  /** Runs once write authority is held, before `work`; a test pause point. */
  afterBegin?: () => void | Promise<void>;
  /** Runs after each attempt that found another connection holding the lock. */
  onBusy?: (attempt: number) => void | Promise<void>;
  /**
   * Runs once the transaction has committed or rolled back. Not awaited, so a
   * hook can never delay or deadlock the caller's result.
   */
  afterRelease?: () => void;
}

interface ImmediateTransactionOptions {
  /** Total `BEGIN IMMEDIATE` attempts before giving up; defaults to 5. */
  maxAttempts?: number;
  /** Delay before each retry; the last value repeats. Defaults to 10, 20, 40, 80 ms. */
  retryDelaysMs?: readonly number[];
  hooks?: ImmediateTransactionHooks;
}

/** Another connection held write authority through every attempt. */
export class WriteAuthorityBusyError extends Error {
  readonly retryable = true;
  readonly attempts: number;

  /** Records how many attempts were made so callers can log the contention. */
  constructor(attempts: number) {
    super(
      `Could not acquire database write authority after ${attempts} attempts`,
    );
    this.name = "WriteAuthorityBusyError";
    this.attempts = attempts;
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAYS_MS = [10, 20, 40, 80];
const BUSY = Symbol("busy");

/** Open while an attempt holds the pinned connection; closed once it is released. */
interface TransactionScope {
  active: boolean;
}

const insideTransaction = new AsyncLocalStorage<TransactionScope>();

/**
 * Runs `work` inside one SQLite `BEGIN IMMEDIATE` transaction, so the caller
 * holds write authority before its first read and every read-modify-write
 * commits or rolls back as a unit. Ordinary `db.transaction()` begins deferred
 * and can read stale state before another writer commits.
 *
 * Only a busy `BEGIN IMMEDIATE` is retried, always before `work` has run, so
 * each retry starts from fresh state; failures inside `work` never retry.
 *
 * Misuse rules:
 * - Never nest calls; a nested call rejects.
 * - Never query the root `db` inside `work`: Kysely's SQLite driver has one
 *   connection behind a mutex that `work` already holds, so it deadlocks.
 * - Never await non-database I/O inside `work`; every other query in the
 *   process waits on the pinned connection until it is released.
 */
export async function runImmediateTransaction<DB, T>(
  db: Kysely<DB>,
  work: (pinned: Kysely<DB>) => Promise<T>,
  options: ImmediateTransactionOptions = {},
): Promise<T> {
  // Checked before taking the connection, which a nested call would wait on forever.
  if (insideTransaction.getStore()?.active) {
    throw new Error("runImmediateTransaction calls cannot be nested");
  }

  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    hooks = {},
  } = options;

  for (let attempt = 1; ; attempt += 1) {
    const scope: TransactionScope = { active: true };
    const result = await insideTransaction.run(scope, () =>
      runAttempt(db, work, hooks, scope),
    );
    if (result !== BUSY) return result.value;

    await observe(() => hooks.onBusy?.(attempt));
    if (attempt >= maxAttempts) throw new WriteAuthorityBusyError(attempt);
    await delay(retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1) ?? 0);
  }
}

/**
 * One attempt on a pinned connection. Returns `BUSY` when another connection
 * holds the lock, releasing the connection so the retry delay never blocks
 * other queries in the process.
 */
async function runAttempt<DB, T>(
  db: Kysely<DB>,
  work: (pinned: Kysely<DB>) => Promise<T>,
  hooks: ImmediateTransactionHooks,
  scope: TransactionScope,
): Promise<{ value: T } | typeof BUSY> {
  let acquired = false;
  try {
    return await db.connection().execute(async (pinned) => {
      try {
        await sql`begin immediate`.execute(pinned);
      } catch (error) {
        if (isBusy(error)) return BUSY;
        throw error;
      }
      acquired = true;

      try {
        await hooks.afterBegin?.();
        const value = await work(pinned);
        await sql`commit`.execute(pinned);
        return { value };
      } catch (error) {
        await rollBack(pinned, error);
        throw error;
      }
    });
  } finally {
    // The connection is released, so work that afterRelease or detached
    // continuations of `work` start later is a new transaction, not a nested one.
    scope.active = false;
    // Closes the holding window that afterBegin opened, on commit or rollback.
    if (acquired) void observe(hooks.afterRelease);
  }
}

/**
 * Rolls back after `failure`, tolerating SQLite having already rolled back on
 * its own (as it does after some errors). Any other rollback failure may leave
 * the connection inside the transaction, so it is reported with the original.
 */
async function rollBack<DB>(
  pinned: Kysely<DB>,
  failure: unknown,
): Promise<void> {
  try {
    await sql`rollback`.execute(pinned);
  } catch (rollbackError) {
    if (isNoActiveTransaction(rollbackError)) return;
    throw new AggregateError(
      [failure, rollbackError],
      "Transaction failed and could not be rolled back",
    );
  }
}

/** Recognizes the error SQLite raises when it already ended the transaction. */
function isNoActiveTransaction(error: unknown): boolean {
  return (
    error instanceof Error && /no transaction is active/i.test(error.message)
  );
}

/**
 * Runs an observer hook so it can never change the transaction's outcome. A
 * throw would otherwise replace a committed result with an error, inviting a
 * retry that repeats the write, or hide the failure that caused a rollback.
 */
async function observe(
  hook: (() => void | Promise<void>) | undefined,
): Promise<void> {
  try {
    await hook?.();
  } catch (error) {
    process.emitWarning(
      error instanceof Error ? error : describeThrownValue(error),
    );
  }
}

/** Describes a non-Error throw without risking a second throw from `String`. */
function describeThrownValue(value: unknown): string {
  try {
    return `Hook threw a non-Error value: ${String(value)}`;
  } catch {
    return "Hook threw a non-Error value";
  }
}

/** Recognizes SQLite's busy family, which better-sqlite3 reports as `code`. */
function isBusy(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_BUSY")
  );
}

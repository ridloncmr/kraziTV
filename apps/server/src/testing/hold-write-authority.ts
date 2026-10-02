import type { Kysely } from "kysely";

import { runImmediateTransaction } from "../database/writes/immediate-transaction.js";
import { createBarrier } from "./test-barrier.js";

export interface HeldWriteAuthority {
  /** Lets the held transaction commit and waits for it; safe to call twice. */
  release(): Promise<void>;
}

/**
 * Starts a transaction on `db` that pauses holding write authority, so a test
 * can race another connection against it. Tests call `release` in `finally`
 * so a failed assertion never leaves the connection parked.
 */
export async function holdWriteAuthority<DB>(
  db: Kysely<DB>,
  work: (pinned: Kysely<DB>) => Promise<void> = async () => {},
): Promise<HeldWriteAuthority> {
  const barrier = createBarrier();
  const held = runImmediateTransaction(db, work, {
    hooks: { afterBegin: () => barrier.wait() },
  });
  await barrier.reached;
  return {
    async release() {
      barrier.release();
      await held;
    },
  };
}

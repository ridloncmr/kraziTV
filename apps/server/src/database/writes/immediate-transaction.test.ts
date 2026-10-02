import { type KyselyPlugin, type RootOperationNode, sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runImmediateTransaction,
  WriteAuthorityBusyError,
} from "./immediate-transaction.js";
import { rootFixture } from "../../testing/catalog-fixtures.js";
import { holdWriteAuthority } from "../../testing/hold-write-authority.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);
afterEach(() => {
  vi.restoreAllMocks();
});

/** Silences and records the warnings the helper emits for failing hooks. */
function spyOnWarnings() {
  return vi.spyOn(process, "emitWarning").mockImplementation(() => {});
}

/** Fails every raw `rollback` statement, as a disk I/O error would. */
function failRollbacks(failure: Error): KyselyPlugin {
  const isRollback = (node: RootOperationNode) =>
    node.kind === "RawNode" &&
    node.sqlFragments.join("").trim().toLowerCase() === "rollback";
  return {
    transformQuery({ node }) {
      if (isRollback(node)) throw failure;
      return node;
    },
    transformResult: async ({ result }) => result,
  };
}

/** Opens two connections to one database file, as two processes would. */
async function openTwoConnections() {
  const dataDirectory = await createTemporaryDirectory();
  const first = await openTestDatabase(dataDirectory);
  const second = await openTestDatabase(dataDirectory, { busyTimeoutMs: 0 });
  return { a: first.db, b: second.db };
}

describe("runImmediateTransaction", () => {
  it("commits the work's writes and returns its value", async () => {
    const { db } = await openTestDatabase();

    const result = await runImmediateTransaction(db, async (pinned) => {
      await pinned.insertInto("media_roots").values(rootFixture).execute();
      return "committed";
    });

    expect(result).toBe("committed");
    await expect(
      db.selectFrom("media_roots").selectAll().execute(),
    ).resolves.toEqual([rootFixture]);
  });

  it("rolls back every write, rethrows the original error, and leaves the connection reusable", async () => {
    const { db } = await openTestDatabase();
    const failure = new Error("work failed");

    await expect(
      runImmediateTransaction(db, async (pinned) => {
        await pinned.insertInto("media_roots").values(rootFixture).execute();
        throw failure;
      }),
    ).rejects.toBe(failure);

    await expect(
      db.selectFrom("media_roots").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      runImmediateTransaction(db, async () => "reusable"),
    ).resolves.toBe("reusable");
  });

  it("rejects a nested call without deadlocking", async () => {
    const { db } = await openTestDatabase();

    const outer = await runImmediateTransaction(db, async () => {
      await expect(
        runImmediateTransaction(db, async () => "nested"),
      ).rejects.toThrow(/nested/i);
      return "outer";
    });

    expect(outer).toBe("outer");
  });

  it("treats calls started after release as new transactions, not nested ones", async () => {
    const { db } = await openTestDatabase();
    let releaseFollowUp!: () => void;
    const outerReleased = new Promise<void>((resolve) => {
      releaseFollowUp = resolve;
    });
    let fromAfterRelease: Promise<unknown> | undefined;

    let detached: Promise<unknown> | undefined;
    await runImmediateTransaction(
      db,
      async () => {
        // Follow-up work the transaction schedules but does not await.
        detached = outerReleased.then(() =>
          runImmediateTransaction(db, async () => "detached"),
        );
      },
      {
        hooks: {
          afterRelease: () => {
            fromAfterRelease = runImmediateTransaction(db, async (pinned) =>
              pinned.selectFrom("media_roots").selectAll().execute(),
            );
            releaseFollowUp();
          },
        },
      },
    );

    await expect(fromAfterRelease).resolves.toEqual([]);
    await expect(detached).resolves.toBe("detached");
  });

  it("fires afterBegin then afterRelease once, on commit and on rollback", async () => {
    const { db } = await openTestDatabase();
    const events: string[] = [];
    const hooks = {
      afterBegin: () => void events.push("afterBegin"),
      afterRelease: () => void events.push("afterRelease"),
    };

    await runImmediateTransaction(db, async () => void events.push("work"), {
      hooks,
    });
    await expect(
      runImmediateTransaction(
        db,
        async () => {
          events.push("work");
          throw new Error("rolled back");
        },
        { hooks },
      ),
    ).rejects.toThrow("rolled back");

    expect(events).toEqual([
      "afterBegin",
      "work",
      "afterRelease",
      "afterBegin",
      "work",
      "afterRelease",
    ]);
  });

  it("tolerates SQLite having already rolled back and rethrows the original error", async () => {
    const { db } = await openTestDatabase();
    const failure = new Error("work failed");

    await expect(
      runImmediateTransaction(db, async (pinned) => {
        await sql`rollback`.execute(pinned);
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(
      runImmediateTransaction(db, async () => "reusable"),
    ).resolves.toBe("reusable");
  });

  it("keeps a commit's result when afterRelease throws, and reports the hook failure", async () => {
    const { db } = await openTestDatabase();
    const warnings = spyOnWarnings();
    const hookFailure = new Error("metric failed");

    const result = await runImmediateTransaction(
      db,
      async (pinned) => {
        await pinned.insertInto("media_roots").values(rootFixture).execute();
        return "committed";
      },
      {
        hooks: {
          afterRelease: () => {
            throw hookFailure;
          },
        },
      },
    );

    expect(result).toBe("committed");
    await expect(
      db.selectFrom("media_roots").selectAll().execute(),
    ).resolves.toEqual([rootFixture]);
    expect(warnings).toHaveBeenCalledWith(hookFailure);
  });

  it("keeps the original failure when afterRelease throws after a rollback", async () => {
    const { db } = await openTestDatabase();
    spyOnWarnings();
    const failure = new Error("work failed");

    await expect(
      runImmediateTransaction(
        db,
        async () => {
          throw failure;
        },
        {
          hooks: {
            afterRelease: () => {
              throw new Error("metric failed");
            },
          },
        },
      ),
    ).rejects.toBe(failure);
  });

  it("reports both errors when the rollback itself fails", async () => {
    const { db } = await openTestDatabase();
    const failure = new Error("work failed");
    const rollbackFailure = new Error("disk I/O error");

    const error = await runImmediateTransaction(
      db.withPlugin(failRollbacks(rollbackFailure)),
      async () => {
        throw failure;
      },
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      failure,
      rollbackFailure,
    ]);
    // The connection is left inside the transaction: the residual risk the
    // aggregate error reports. End it so cleanup can close the database.
    await sql`rollback`.execute(db);
  });

  describe("across two connections", () => {
    it("keeps retrying and reports busy when onBusy throws", async () => {
      const { a, b } = await openTwoConnections();
      const warnings = spyOnWarnings();
      const holder = await holdWriteAuthority(a);

      try {
        const onBusy = vi.fn(() => {
          throw new Error("metric failed");
        });
        await expect(
          runImmediateTransaction(b, async () => undefined, {
            maxAttempts: 2,
            retryDelaysMs: [0],
            hooks: { onBusy },
          }),
        ).rejects.toBeInstanceOf(WriteAuthorityBusyError);
        expect(onBusy).toHaveBeenCalledTimes(2);
        expect(warnings).toHaveBeenCalledTimes(2);
      } finally {
        await holder.release();
      }
    });

    it("acquires write authority before the work's first read", async () => {
      const { a, b } = await openTwoConnections();
      const holder = await holdWriteAuthority(a);

      try {
        const work = vi.fn(async () => undefined);
        await expect(
          runImmediateTransaction(b, work, { maxAttempts: 1 }),
        ).rejects.toBeInstanceOf(WriteAuthorityBusyError);
        expect(work).not.toHaveBeenCalled();
      } finally {
        await holder.release();
      }
    });

    it("retries the loser from fresh state once the holder commits", async () => {
      const { a, b } = await openTwoConnections();
      const holder = await holdWriteAuthority(a, async (pinned) => {
        await pinned.insertInto("media_roots").values(rootFixture).execute();
      });

      try {
        const roots = await runImmediateTransaction(
          b,
          (pinned) => pinned.selectFrom("media_roots").selectAll().execute(),
          { retryDelaysMs: [0], hooks: { onBusy: holder.release } },
        );

        expect(roots).toEqual([rootFixture]);
      } finally {
        await holder.release();
      }
    });

    it("gives up with a retryable error after exactly maxAttempts busy attempts", async () => {
      const { a, b } = await openTwoConnections();
      const holder = await holdWriteAuthority(a);

      try {
        const onBusy = vi.fn();
        const failure = await runImmediateTransaction(
          b,
          async () => undefined,
          { maxAttempts: 3, retryDelaysMs: [0], hooks: { onBusy } },
        ).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(WriteAuthorityBusyError);
        expect(failure).toMatchObject({ retryable: true, attempts: 3 });
        expect(onBusy.mock.calls).toEqual([[1], [2], [3]]);
      } finally {
        await holder.release();
      }
    });
  });
});

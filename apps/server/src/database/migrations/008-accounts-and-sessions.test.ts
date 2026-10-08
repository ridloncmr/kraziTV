import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const TIME = 1_700_000_000_000;
const account = {
  id: "account-1",
  display_name: "Owner",
  avatar_id: "duck",
  password_hash: "scrypt$1$1$1$salt$hash",
  created_at: TIME,
  updated_at: TIME,
};
const session = {
  id: "session-1",
  account_id: "account-1",
  token_hash: "token-hash-1",
  created_at: TIME,
  expires_at: TIME + 1,
};

describe("008_accounts_and_sessions", () => {
  it("stores an account and its sessions", async () => {
    const database = await openTestDatabase();
    await database.db.insertInto("accounts").values(account).execute();
    await database.db.insertInto("sessions").values(session).execute();

    await expect(
      database.db.selectFrom("accounts").selectAll().execute(),
    ).resolves.toEqual([account]);
    await expect(
      database.db.selectFrom("sessions").selectAll().execute(),
    ).resolves.toEqual([session]);
  });

  it("deletes an account's sessions with the account", async () => {
    const database = await openTestDatabase();
    await database.db.insertInto("accounts").values(account).execute();
    await database.db.insertInto("sessions").values(session).execute();

    await database.db.deleteFrom("accounts").execute();

    await expect(
      database.db.selectFrom("sessions").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("rejects a session for an unknown account", async () => {
    const database = await openTestDatabase();

    await expect(
      database.db.insertInto("sessions").values(session).execute(),
    ).rejects.toThrow(/foreign key/i);
  });

  it("rejects a second session with the same token hash", async () => {
    const database = await openTestDatabase();
    await database.db.insertInto("accounts").values(account).execute();
    await database.db.insertInto("sessions").values(session).execute();

    await expect(
      database.db
        .insertInto("sessions")
        .values({ ...session, id: "session-2" })
        .execute(),
    ).rejects.toThrow(/unique/i);
  });

  it("rejects an account whose display name is blank", async () => {
    const database = await openTestDatabase();

    await expect(
      database.db
        .insertInto("accounts")
        .values({ ...account, display_name: "   " })
        .execute(),
    ).rejects.toThrow(/constraint/i);
  });

  it.each([
    ["accounts", "created_at"],
    ["accounts", "updated_at"],
    ["sessions", "created_at"],
    ["sessions", "expires_at"],
  ] as const)(
    "rejects %s.%s when it is not a safe integer",
    async (table, column) => {
      const database = await openTestDatabase();
      await database.db.insertInto("accounts").values(account).execute();
      await database.db.insertInto("sessions").values(session).execute();

      for (const invalid of [-1, 1.5, "soon", Number.MAX_SAFE_INTEGER + 2]) {
        await expect(
          sql`update ${sql.table(table)} set ${sql.ref(column)} = ${invalid}`.execute(
            database.db,
          ),
        ).rejects.toThrow(/constraint/i);
      }
    },
  );

  it("indexes sessions by account for the cascade", async () => {
    const database = await openTestDatabase();

    const indexes = await sql<{ name: string }>`
      select name from pragma_index_list('sessions')
    `.execute(database.db);

    expect(indexes.rows.map((row) => row.name)).toContain(
      "sessions_account_id",
    );
  });
});

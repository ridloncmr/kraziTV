// Auth table reads for tests only; production code must never import this module.
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/** Reads every session's expiry, oldest first. */
export async function readSessionExpiries(
  db: Kysely<DatabaseSchema>,
): Promise<number[]> {
  const rows = await db
    .selectFrom("sessions")
    .select("expires_at")
    .orderBy("expires_at")
    .execute();
  return rows.map((row) => row.expires_at);
}

/** Counts the rows a refused request must leave untouched. */
export async function countAuthRows(
  db: Kysely<DatabaseSchema>,
): Promise<{ channels: number; accounts: number; sessions: number }> {
  const [channels, accounts, sessions] = await Promise.all([
    db.selectFrom("channels").select("id").execute(),
    db.selectFrom("accounts").select("id").execute(),
    db.selectFrom("sessions").select("id").execute(),
  ]);
  return {
    channels: channels.length,
    accounts: accounts.length,
    sessions: sessions.length,
  };
}

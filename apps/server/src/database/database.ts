import { mkdir } from "node:fs/promises";

import SqliteDatabase from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { resolveDatabasePath } from "../config/data-directory.js";
import { migrateDatabase } from "./migrations/migrate-database.js";
import type { DatabaseSchema } from "./schema/database-schema.js";

export interface OpenDatabaseOptions {
  dataDirectory: string;
  /**
   * How long SQLite blocks waiting for another connection's lock. Defaults to
   * 0 because better-sqlite3 waits synchronously, freezing the event loop;
   * callers retry asynchronously instead.
   */
  busyTimeoutMs?: number | undefined;
}

export interface KraziDatabase {
  readonly db: Kysely<DatabaseSchema>;
  readonly databasePath: string;

  /** Releases the SQLite handle so shutdown and Windows cleanup are reliable. */
  close(): Promise<void>;
}

// Opens a migrated local database whose complete lifecycle is owned by the caller.
export async function openDatabase(
  options: OpenDatabaseOptions,
): Promise<KraziDatabase> {
  const { dataDirectory, busyTimeoutMs = 0 } = options;
  await mkdir(dataDirectory, { recursive: true });

  const databasePath = resolveDatabasePath(dataDirectory);
  const sqlite = new SqliteDatabase(databasePath, {
    timeout: busyTimeoutMs,
  });
  try {
    sqlite.pragma("foreign_keys = ON");
    // WAL lets readers proceed while a writer holds BEGIN IMMEDIATE.
    sqlite.pragma("journal_mode = WAL");
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  try {
    await migrateDatabase(db);
  } catch (error) {
    await db.destroy();
    throw error;
  }

  let closed = false;

  return {
    db,
    databasePath,

    // Makes duplicate shutdown paths harmless while closing the real connection once.
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      await db.destroy();
    },
  };
}

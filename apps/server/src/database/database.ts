import { mkdir } from "node:fs/promises";

import SqliteDatabase from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { resolveDatabasePath } from "../data-directory.js";
import { migrateDatabase } from "./migrations.js";
import type { DatabaseSchema } from "./schema.js";

export interface OpenDatabaseOptions {
  dataDirectory: string;
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
  const { dataDirectory } = options;
  await mkdir(dataDirectory, { recursive: true });

  const databasePath = resolveDatabasePath(dataDirectory);
  const sqlite = new SqliteDatabase(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
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

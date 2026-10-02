import type { Kysely } from "kysely";
import {
  type Migration,
  type MigrationProvider,
  Migrator,
} from "kysely/migration";

import { initialCatalogMigration } from "./001-initial-catalog.js";
import { mediaCollectionsMigration } from "./002-media-collections.js";
import { channelsMigration } from "./003-channels.js";
import { programmingBlocksMigration } from "./004-programming-blocks.js";
import type { DatabaseSchema } from "../schema/database-schema.js";

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "001_initial_catalog": initialCatalogMigration,
  "002_media_collections": mediaCollectionsMigration,
  "003_channels": channelsMigration,
  "004_programming_blocks": programmingBlocksMigration,
});

class CommittedMigrationProvider implements MigrationProvider {
  // Returns the fixed committed history so every environment sees the same order.
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...migrations };
  }
}

// Applies the committed migration history and surfaces the original migration error.
export async function migrateDatabase(
  db: Kysely<DatabaseSchema>,
): Promise<void> {
  const { error } = await new Migrator({
    db,
    provider: new CommittedMigrationProvider(),
  }).migrateToLatest();

  if (error !== undefined) {
    // Kysely types the failure as unknown; rethrow it unwrapped.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw error;
  }
}

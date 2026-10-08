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
import { schedulesMigration } from "./005-schedules.js";
import { mediaVideoMigration } from "./006-media-video.js";
import { catalogRemovalMigration } from "./007-catalog-removal.js";
import { accountsAndSessionsMigration } from "./008-accounts-and-sessions.js";
import type { DatabaseSchema } from "../schema/database-schema.js";

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "001_initial_catalog": initialCatalogMigration,
  "002_media_collections": mediaCollectionsMigration,
  "003_channels": channelsMigration,
  "004_programming_blocks": programmingBlocksMigration,
  "005_schedules": schedulesMigration,
  "006_media_video": mediaVideoMigration,
  "007_catalog_removal": catalogRemovalMigration,
  "008_accounts_and_sessions": accountsAndSessionsMigration,
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

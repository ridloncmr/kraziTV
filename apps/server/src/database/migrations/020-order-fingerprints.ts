import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const orderFingerprintsMigration: Migration = {
  // Lets progress in a metadata playback mode remember which order the
  // schedule was generated from, so a metadata write that changes the order
  // regenerates and one that does not changes nothing (programming spec
  // 0003). Random never reads metadata, so it never holds one. Existing rows
  // read back null, so the first maintenance pass regenerates each episode-
  // or release-order channel once and records its order; those modes are new
  // with this feature, so few such rows exist.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table channel_collection_progress add column order_fingerprint text
      constraint channel_collection_progress_order_fingerprint
      check (order_fingerprint is null or (length(order_fingerprint) > 0 and playback_mode <> 'random'))`.execute(
      db,
    );
  },

  // Drops the column; progress itself is unaffected.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("channel_collection_progress")
      .dropColumn("order_fingerprint")
      .execute();
  },
};

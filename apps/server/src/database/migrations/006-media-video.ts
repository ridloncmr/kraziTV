import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const mediaVideoMigration: Migration = {
  // Records whether an item has a real video stream, so audio-only media is
  // packaged over black video. Items cataloged earlier keep null until their
  // next scan; playout treats null as video, the behavior they had before.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table media_items add column has_video integer
      constraint media_items_has_video_boolean
      check (has_video is null or has_video in (0, 1))`.execute(db);
  },

  // Drops the column; nothing else references it.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable("media_items").dropColumn("has_video").execute();
  },
};

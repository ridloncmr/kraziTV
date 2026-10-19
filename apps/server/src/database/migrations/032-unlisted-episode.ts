import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const unlistedEpisodeMigration: Migration = {
  // Records whether an episode's match found no such episode in its TMDB
  // season (programming spec 0001, ADR 0017), so Media Library can say so
  // without inferring it from a missing title, which a listed episode may
  // lack too. Matches stored before this column are listed, since an
  // unlisted episode could not be matched then.
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`alter table content_facts
      add column episode_unlisted integer not null default 0
      constraint content_facts_episode_unlisted_boolean
      check (episode_unlisted in (0, 1))`.execute(db);
  },

  // Drops the flag; the match and its numbers stay.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable("content_facts")
      .dropColumn("episode_unlisted")
      .execute();
  },
};

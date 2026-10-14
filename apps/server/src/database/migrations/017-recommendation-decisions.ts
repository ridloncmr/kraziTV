import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const recommendationDecisionsMigration: Migration = {
  // Records the owner's decision on each collection recommendation
  // (programming spec 0002), keyed by its criterion's canonical JSON, so a
  // rescan recognizes it. A decision outlives any collection it created:
  // deleting an accepted collection never brings its recommendation back.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable("collection_recommendation_decisions")
      .addColumn("criterion_key", "text", (column) =>
        column
          .primaryKey()
          .check(
            sql`json_valid(criterion_key) and json_type(criterion_key) = 'object'`,
          ),
      )
      .addColumn("decision", "text", (column) =>
        column.notNull().check(sql`decision in ('accepted', 'dismissed')`),
      )
      .addColumn("decided_at", "integer", (column) =>
        column
          .notNull()
          .check(
            sql`typeof(decided_at) = 'integer' and decided_at between 0 and ${MAX_SAFE_INTEGER}`,
          ),
      )
      .execute();
  },

  // Drops the decisions; collections stay.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("collection_recommendation_decisions").execute();
  },
};

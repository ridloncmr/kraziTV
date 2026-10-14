import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const recommendationDecisionsMigration: Migration = {
  // Records the owner's decision on each collection recommendation
  // (programming spec 0002), keyed by its criterion's canonical JSON, so a
  // rescan recognizes it. An acceptance records the collection it created,
  // which shows the recommendation as already created however that
  // collection is later converted; deleting it clears the link but keeps
  // the decision, so the recommendation never comes back on its own.
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
      .addColumn("media_collection_id", "text", (column) =>
        column.references("media_collections.id").onDelete("set null"),
      )
      .addColumn("decided_at", "integer", (column) =>
        column
          .notNull()
          .check(
            sql`typeof(decided_at) = 'integer' and decided_at between 0 and ${MAX_SAFE_INTEGER}`,
          ),
      )
      .addCheckConstraint(
        "collection_recommendation_decisions_dismissal_unlinked",
        sql`decision = 'accepted' or media_collection_id is null`,
      )
      .execute();
  },

  // Drops the decisions; collections stay.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("collection_recommendation_decisions").execute();
  },
};

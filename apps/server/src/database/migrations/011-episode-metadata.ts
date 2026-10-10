import { type Kysely, sql, type Transaction } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

// The episode columns content facts gain, each a nullable non-negative integer
// except the series name. Season 0 is TMDB's specials season.
const EPISODE_COLUMNS = [
  ["series_tmdb_id", "integer"],
  ["series_name", "text"],
  ["season_number", "integer"],
  ["episode_number", "integer"],
  ["last_episode_number", "integer"],
] as const;

export const episodeMetadataMigration: Migration = {
  // Lets content facts describe an episode (programming spec 0001): its
  // series identity and name, season, and episode range, and lets its TMDB
  // reference name the series. SQLite cannot change a check constraint in
  // place, so the reference table is rebuilt with its rows.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      for (const [column, type] of EPISODE_COLUMNS) {
        const ref = sql.ref(column);
        const check =
          type === "text"
            ? sql`${ref} is null or length(trim(${ref})) > 0`
            : sql`${ref} is null or (typeof(${ref}) = 'integer' and ${ref} between 0 and ${MAX_SAFE_INTEGER})`;
        await sql`alter table content_facts add column ${ref} ${sql.raw(type)}
          constraint ${sql.raw(`content_facts_${column}_valid`)} check (${check})`.execute(
          trx,
        );
      }
      await rebuildProviderRefs(trx, ["movie", "tv"]);
    });
  },

  // Restores movie-only references, dropping TV ones, and the episode columns.
  // Episode decisions and their remaining facts stay, as 010 can hold them;
  // they lose only the series, season, and episode a rollback cannot keep.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await sql`delete from metadata_provider_refs where external_kind != 'movie'`.execute(
        trx,
      );
      await rebuildProviderRefs(trx, ["movie"]);
      for (const [column] of EPISODE_COLUMNS.toReversed()) {
        await trx.schema
          .alterTable("content_facts")
          .dropColumn(column)
          .execute();
      }
    });
  },
};

/**
 * Recreates `metadata_provider_refs` as 010 defined it but allowing `kinds`,
 * copying every row across. Nothing references the table, so dropping the
 * old one cannot cascade.
 */
async function rebuildProviderRefs(
  trx: Transaction<unknown>,
  kinds: readonly string[],
): Promise<void> {
  const safeInteger = (column: string) => {
    const ref = sql.ref(column);
    return sql`typeof(${ref}) = 'integer' and ${ref} between 0 and ${MAX_SAFE_INTEGER}`;
  };
  await trx.schema
    .createTable("metadata_provider_refs_next")
    .addColumn("media_item_id", "text", (column) =>
      column.primaryKey().references("media_items.id").onDelete("cascade"),
    )
    .addColumn("provider", "text", (column) => column.notNull())
    .addColumn("external_kind", "text", (column) => column.notNull())
    .addColumn("external_id", "integer", (column) => column.notNull())
    .addColumn("fetched_at", "integer", (column) => column.notNull())
    .addCheckConstraint(
      "metadata_provider_refs_provider_known",
      sql`provider = 'tmdb' and external_kind in (${sql.join(
        kinds.map((kind) => sql.lit(kind)),
      )})`,
    )
    .addCheckConstraint(
      "metadata_provider_refs_external_id_safe_integer",
      safeInteger("external_id"),
    )
    .addCheckConstraint(
      "metadata_provider_refs_fetched_at_safe_integer",
      safeInteger("fetched_at"),
    )
    .execute();
  await sql`insert into metadata_provider_refs_next
    select media_item_id, provider, external_kind, external_id, fetched_at
    from metadata_provider_refs`.execute(trx);
  await trx.schema.dropTable("metadata_provider_refs").execute();
  await trx.schema
    .alterTable("metadata_provider_refs_next")
    .renameTo("metadata_provider_refs")
    .execute();
}

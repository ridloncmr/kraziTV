import { randomUUID } from "node:crypto";

import { type Kysely, type RawBuilder, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Inlined as SQL text because SQLite DDL cannot take bound parameters. Each
// migration keeps its own copy so committed history never shifts under a shared edit.
const MAX_SAFE_INTEGER = sql.raw(String(Number.MAX_SAFE_INTEGER));

// Null, or text that is not blank once trimmed.
function nullableText(column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`${ref} is null or length(trim(${ref})) > 0`;
}

// Null, or an integer within `0..MAX_SAFE_INTEGER`.
function nullableCount(column: string): RawBuilder<unknown> {
  const ref = sql.ref(column);
  return sql`${ref} is null or (typeof(${ref}) = 'integer' and ${ref} between 0 and ${MAX_SAFE_INTEGER})`;
}

// The case-insensitive key a tag name resolves by, as it was when this
// migration ran; later code keeps its own copy of the rule.
function tagKey(name: string): string {
  return name.trim().toLowerCase();
}

export const tagsMigration: Migration = {
  // Gives the owner's tags identities (programming spec 0002), so a tag
  // collection matches one tag however its items spell it. Each item's tags
  // move from the JSON column on its corrections row into a join that keeps
  // their order. A name resolves case-insensitively, so `Christmas` and
  // `christmas` become one tag, named as first met in item ID order. The corrections table is
  // rebuilt without the column, since SQLite cannot drop a column a check
  // constraint names; a row left correcting nothing goes, as it would have.
  async up(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.schema
        .createTable("tags")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("name", "text", (column) =>
          column.notNull().check(sql`length(trim(name)) > 0`),
        )
        .addColumn("name_key", "text", (column) => column.notNull().unique())
        .execute();
      await trx.schema
        .createTable("media_item_tags")
        .addColumn("media_item_id", "text", (column) =>
          column.notNull().references("media_items.id").onDelete("cascade"),
        )
        .addColumn("tag_id", "text", (column) =>
          column.notNull().references("tags.id").onDelete("cascade"),
        )
        .addColumn("position", "integer", (column) =>
          column
            .notNull()
            .check(
              sql`typeof(position) = 'integer' and position between 0 and ${MAX_SAFE_INTEGER}`,
            ),
        )
        .addPrimaryKeyConstraint("media_item_tags_pk", [
          "media_item_id",
          "tag_id",
        ])
        .addUniqueConstraint("media_item_tags_position_unique", [
          "media_item_id",
          "position",
        ])
        .execute();
      // The key leads with the item, so a tag's items need their own index.
      await trx.schema
        .createIndex("media_item_tags_tag_id")
        .on("media_item_tags")
        .column("tag_id")
        .execute();

      const { rows: tagged } = await sql<{
        media_item_id: string;
        tags: string;
      }>`select media_item_id, tags from metadata_corrections order by media_item_id`.execute(
        trx,
      );
      const ids = new Map<string, string>();
      for (const { media_item_id, tags } of tagged) {
        let position = 0;
        const seen = new Set<string>();
        for (const name of JSON.parse(tags) as string[]) {
          const key = tagKey(name);
          if (key === "" || seen.has(key)) continue;
          seen.add(key);
          let id = ids.get(key);
          if (id === undefined) {
            id = randomUUID();
            ids.set(key, id);
            await sql`insert into tags (id, name, name_key) values (${id}, ${name.trim()}, ${key})`.execute(
              trx,
            );
          }
          await sql`insert into media_item_tags (media_item_id, tag_id, position) values (${media_item_id}, ${id}, ${position++})`.execute(
            trx,
          );
        }
      }

      await createCorrections(trx, "metadata_corrections_next", false);
      await sql`insert into metadata_corrections_next (media_item_id, title, series_name, season_number, episode_number)
        select media_item_id, title, series_name, season_number, episode_number
        from metadata_corrections
        where title is not null or series_name is not null or season_number is not null or episode_number is not null`.execute(
        trx,
      );
      await trx.schema.dropTable("metadata_corrections").execute();
      await sql`alter table metadata_corrections_next rename to metadata_corrections`.execute(
        trx,
      );
    });
  },

  // Folds each item's tags back into a JSON column on its corrections row,
  // creating a row for an item that has only tags, then drops the tag tables.
  async down(db: Kysely<unknown>): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await createCorrections(trx, "metadata_corrections_previous", true);
      await sql`insert into metadata_corrections_previous (media_item_id, title, series_name, season_number, episode_number, tags)
        select ids.media_item_id, c.title, c.series_name, c.season_number, c.episode_number,
          coalesce((select json_group_array(t.name order by it.position)
            from media_item_tags it join tags t on t.id = it.tag_id
            where it.media_item_id = ids.media_item_id), '[]')
        from (select media_item_id from metadata_corrections
          union select media_item_id from media_item_tags) ids
        left join metadata_corrections c on c.media_item_id = ids.media_item_id`.execute(
        trx,
      );
      await trx.schema.dropTable("metadata_corrections").execute();
      await sql`alter table metadata_corrections_previous rename to metadata_corrections`.execute(
        trx,
      );
      await trx.schema.dropTable("media_item_tags").execute();
      await trx.schema.dropTable("tags").execute();
    });
  },
};

// Creates the corrections table under `name`, with the JSON tags column of
// migration 012 only when `withTags`, and every other column and check as 012
// defined them.
async function createCorrections(
  trx: Kysely<unknown>,
  name: string,
  withTags: boolean,
): Promise<void> {
  let table = trx.schema
    .createTable(name)
    .addColumn("media_item_id", "text", (column) =>
      column.primaryKey().references("media_items.id").onDelete("cascade"),
    )
    .addColumn("title", "text")
    .addColumn("series_name", "text")
    .addColumn("season_number", "integer")
    .addColumn("episode_number", "integer")
    .addCheckConstraint(`${name}_title_valid`, nullableText("title"))
    .addCheckConstraint(
      `${name}_series_name_valid`,
      nullableText("series_name"),
    )
    .addCheckConstraint(
      `${name}_season_number_valid`,
      nullableCount("season_number"),
    )
    .addCheckConstraint(
      `${name}_episode_number_valid`,
      nullableCount("episode_number"),
    );
  if (withTags) {
    table = table
      .addColumn("tags", "text", (column) => column.notNull())
      .addCheckConstraint(
        `${name}_tags_array`,
        sql`json_valid(tags) and json_type(tags) = 'array'`,
      );
  }
  await table.execute();
}

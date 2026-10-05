import type { ColumnType } from "kysely";

// SQLite has no boolean type; columns store 0 or 1, enforced by check constraints.
export type SqliteBoolean = ColumnType<number, number, number>;

/** Encodes a domain boolean for a 0/1 column. */
export function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/** Decodes a 0/1 column; any other value is rejected by the check constraint. */
export function fromSqliteBoolean(value: number): boolean {
  return value === 1;
}

/** Decodes a nullable 0/1 column, keeping null as "not known yet". */
export function fromNullableSqliteBoolean(
  value: number | null,
): boolean | null {
  return value === null ? null : fromSqliteBoolean(value);
}

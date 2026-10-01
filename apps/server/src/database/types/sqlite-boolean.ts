import type { ColumnType } from "kysely";

// SQLite has no boolean type; columns store 0 or 1, enforced by check constraints.
export type SqliteBoolean = ColumnType<number, number, number>;

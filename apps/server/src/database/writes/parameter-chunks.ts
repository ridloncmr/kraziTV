import { sql, type RawBuilder } from "kysely";

// Keeps every statement well under SQLite's 32,766 bound-parameter limit.
const CHUNK_SIZE = 1_000;

/** Splits a list so each statement stays within SQLite's parameter limit. */
export function parameterChunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += CHUNK_SIZE) {
    result.push(values.slice(start, start + CHUNK_SIZE));
  }
  return result;
}

/**
 * Selects each ID of a list as a parenthesized subquery any statement can
 * test membership against. The list binds as one JSON parameter, so one
 * statement handles any number of IDs without meeting SQLite's parameter
 * limit, where `parameterChunks` needs one statement per chunk.
 */
export function jsonIdList(ids: readonly string[]): RawBuilder<string> {
  return sql<string>`(select value from json_each(${JSON.stringify(ids)}))`;
}

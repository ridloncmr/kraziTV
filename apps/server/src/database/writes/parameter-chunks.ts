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

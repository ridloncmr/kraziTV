/**
 * Recognizes a unique-constraint failure on one `table.column`, so a
 * repository can report an identity collision while every other failure
 * propagates.
 */
export function isUniqueViolation(error: unknown, column: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
    error.message.includes(column)
  );
}

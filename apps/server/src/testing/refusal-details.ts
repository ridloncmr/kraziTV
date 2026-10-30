// Refusal assertions for route and acceptance tests only; production code must never import this module.
import { expect } from "vitest";

/**
 * Asserts a refusal's code, that its details carry `details`, and that its
 * message names no string among them, at any depth of arrays and objects,
 * so an ID inside a nested detail such as `member` is checked too. The
 * message is for logs; the web app words a refusal from its code and
 * details, so an ID in the message would reach the owner (release-polish
 * spec 0002, decision 1). Pass IDs and the objects that hold them here; assert a detail the
 * message may quote, such as a problem's text, separately. Takes the
 * response body, whose `error` is the envelope `sendApiError` sends.
 */
export function expectRefusal(
  body: unknown,
  code: string,
  details: Readonly<Record<string, unknown>>,
): void {
  const error = (body as { error: { message: string } }).error;
  expect(error).toMatchObject({ code, ...details });
  for (const value of strings(details)) {
    expect(error.message).not.toContain(value);
  }
}

/** Every string inside `value`, through arrays and objects at any depth. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(strings);
}

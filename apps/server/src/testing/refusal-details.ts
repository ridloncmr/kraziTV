// Refusal assertions for route and acceptance tests only; production code must never import this module.
import { expect } from "vitest";

/**
 * Asserts a refusal's code, that its details carry `details`, and that its
 * message names no string among them, alone or in an array. The message is
 * for logs; the web app words a refusal from its code and details, so an ID
 * in the message would reach the owner (release-polish spec 0002, decision
 * 1). Pass IDs and the objects that hold them here; assert a detail the
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
  for (const value of Object.values(details).flat()) {
    if (typeof value === "string") expect(error.message).not.toContain(value);
  }
}

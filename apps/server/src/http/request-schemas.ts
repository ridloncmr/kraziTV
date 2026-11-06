import { z } from "zod";

/** Route parameters for every `/:id` resource route. */
export const idParams = z.object({ id: z.string() });

/**
 * A UTC ISO 8601 instant such as `2024-01-01T00:00:00Z`, parsed to epoch
 * milliseconds. Offsets and zoneless times are rejected so every instant
 * the API accepts reads the same everywhere.
 */
export const isoInstantField = z.iso
  .datetime()
  .transform((value) => Date.parse(value));

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A `[start, end)` query of UTC instants: `start` before `end`, at most
 * `maxWindowMs` apart. The caller supplies the limit, so `http/` never
 * imports a domain's policy.
 */
export function windowQuery(maxWindowMs: number) {
  return z
    .strictObject({ start: isoInstantField, end: isoInstantField })
    .refine((window) => window.end > window.start, {
      message: "end must be after start",
      path: ["end"],
    })
    .refine((window) => window.end - window.start <= maxWindowMs, {
      message: `the window must not exceed ${maxWindowMs / DAY_MS} days`,
      path: ["end"],
    });
}

/** A list of media item IDs naming each item once; a duplicate is a caller error. */
export const uniqueMediaItemIds = z
  .array(z.string())
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "mediaItemIds must not contain duplicates",
  });

/** A display name: trimmed, and never empty once trimmed. */
export const nameField = z.string().trim().min(1, "name must not be empty");

/**
 * A channel or collection name: a display name of at most 120 characters,
 * so a pasted paragraph is refused instead of stored (release-polish
 * decision 18). The cap is not on `nameField` itself: its other callers
 * carry titles, tags, and search text, which that decision does not cap.
 */
export const longNameField = nameField.max(
  120,
  "name must be at most 120 characters",
);

/**
 * An assignment or rule name: trimmed and at most 80 characters, so a
 * rule's name is capped as an assignment's is (release-polish spec 0005).
 * Not built on `nameField`, because a blank assignment name means it is
 * named by its members; a rule adds the non-empty check itself.
 */
export const shortNameField = z
  .string()
  .trim()
  .max(80, "name must be at most 80 characters");

/**
 * The three stretch shapes an assignment or rule source sets; kraziBrain's
 * stretch rule decides which values are valid.
 */
export const stretchField = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("programs"), count: z.number() }),
  z.strictObject({ kind: z.literal("airtime"), minutes: z.number() }),
  z.strictObject({
    kind: z.literal("airtime_range"),
    minMinutes: z.number(),
    maxMinutes: z.number(),
  }),
]);

/** A season or episode number as content facts store it; season 0 holds specials. */
export const countField = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** A four-digit release year, from the first films to the far future. */
export const yearField = z.number().int().min(1878).max(9999);

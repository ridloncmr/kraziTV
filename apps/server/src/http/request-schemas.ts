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

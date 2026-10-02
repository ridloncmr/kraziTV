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

/** A display name: trimmed, and never empty once trimmed. */
export const nameField = z.string().trim().min(1, "name must not be empty");

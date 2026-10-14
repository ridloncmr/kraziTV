import { z } from "zod";

import type { CollectionCriterion } from "../contracts.js";

/**
 * What an automatic collection matches on. Validated here once, for request
 * bodies and stored rows alike, so the two never disagree on what a
 * criterion is.
 */
export const collectionCriterionSchema: z.ZodType<CollectionCriterion> =
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("series"),
      tmdbId: z.number().int().positive(),
    }),
    z.strictObject({
      kind: z.literal("franchise"),
      tmdbId: z.number().int().positive(),
    }),
    z.strictObject({ kind: z.literal("tag"), tagId: z.string().min(1) }),
    z.strictObject({ kind: z.literal("genre"), name: z.string().min(1) }),
  ]);

/**
 * The criterion's canonical JSON: fixed key order, so two equal criteria
 * always store the same text, which is also a recommendation's identity.
 */
export function criterionKey(criterion: CollectionCriterion): string {
  switch (criterion.kind) {
    case "tag":
      return JSON.stringify({ kind: criterion.kind, tagId: criterion.tagId });
    case "genre":
      return JSON.stringify({ kind: criterion.kind, name: criterion.name });
    default:
      return JSON.stringify({ kind: criterion.kind, tmdbId: criterion.tmdbId });
  }
}

/**
 * Reads a stored criterion, or undefined when it is not one this version
 * understands. Never throws, so one unreadable row cannot break a listing
 * or a maintenance pass over every other collection.
 */
export function readStoredCriterion(
  stored: string,
): CollectionCriterion | undefined {
  try {
    const parsed = collectionCriterionSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

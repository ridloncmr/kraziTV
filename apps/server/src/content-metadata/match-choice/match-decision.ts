import type { EpisodeLookup, MovieLookup } from "@krazitv/media";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MetadataMatchRecord } from "../contracts.js";
import type { MatchEvidence } from "./match-evidence.js";

/** One cataloged item's match decision, as the owner's choices read it. */
interface Decision {
  id: string;
  rootId: string;
  pathKey: string;
  durationMs: number | null;
  state: "unmatched" | "ambiguous" | "matched" | "rejected";
  extra: boolean;
  lookedUpAt: number | null;
  evidence: string;
}

/** An ambiguous item a choice may resolve, with its evidence read. */
export type Waiting = Decision & MatchEvidence;

/**
 * Starts a read of cataloged items' match decisions through `executor`. A
 * removed item is left out, so no choice can restore one.
 */
export function selectDecisions(executor: Kysely<DatabaseSchema>) {
  return executor
    .selectFrom("metadata_matches")
    .innerJoin(
      "media_items",
      "media_items.id",
      "metadata_matches.media_item_id",
    )
    .select([
      "media_items.id",
      "media_items.media_root_id as rootId",
      "media_items.path_key as pathKey",
      "media_items.duration_ms as durationMs",
      "metadata_matches.state",
      "metadata_matches.extra",
      "metadata_matches.looked_up_at as lookedUpAt",
      "metadata_matches.evidence",
    ])
    .where("media_items.removed_at", "is", null);
}

/** Reads one cataloged item's decision; undefined when it has none or is removed. */
export async function readDecision(
  executor: Kysely<DatabaseSchema>,
  mediaItemId: string,
): Promise<Decision | undefined> {
  const row = await selectDecisions(executor)
    .where("media_items.id", "=", mediaItemId)
    .executeTakeFirst();
  return row === undefined ? undefined : { ...row, extra: row.extra === 1 };
}

/** The record a chosen match stores, marked as the owner's choice. */
export function chosenRecord(
  item: Waiting,
  lookup: MovieLookup | EpisodeLookup,
  lookedUpAt: number,
): MetadataMatchRecord {
  return {
    kind: "looked_up",
    pathKey: item.pathKey,
    hints: item.hints,
    lookedUpAt,
    durationMs: item.durationMs,
    lookup,
    chosen: true,
  };
}

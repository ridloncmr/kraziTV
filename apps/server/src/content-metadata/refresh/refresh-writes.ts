import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import {
  jsonIdList,
  parameterChunks,
} from "../../database/writes/parameter-chunks.js";
import { contentFactsOf } from "../persistence/match-rows.js";
import type { RefreshAnswer } from "./due-refreshes.js";

/**
 * The TMDB facts expiry drops. TMDB IDs, content type, and season and
 * episode numbers stay, so episode order survives until a refresh refills
 * the rest.
 */
const EXPIRED_FACTS = {
  title: null,
  description: null,
  genres: "[]",
  release_date: null,
  franchise_name: null,
  poster_path: null,
  series_name: null,
};

/**
 * Drops TMDB data stored longer than TMDB allows, under write authority:
 * provider facts fetched at or before `storedBefore`, and candidate lists
 * looked up by then, whose items return to unmatched so the next scan looks
 * them up again. Items under a root `isScanning` reports busy are left for
 * the next pass, so this never interleaves with a scan or retry commit.
 * Returns how many items changed.
 */
export async function expireStoredFacts(
  db: Kysely<DatabaseSchema>,
  storedBefore: number,
  expiredAt: number,
  isScanning: (rootId: string) => boolean,
): Promise<number> {
  return runImmediateTransaction(db, async (pinned) => {
    const facts = await pinned
      .selectFrom("metadata_provider_refs")
      .innerJoin(
        "media_items",
        "media_items.id",
        "metadata_provider_refs.media_item_id",
      )
      .select(["media_items.id", "media_items.media_root_id as rootId"])
      .where("metadata_provider_refs.fetched_at", "<=", storedBefore)
      .where("metadata_provider_refs.expired_at", "is", null)
      .execute();
    const candidates = await pinned
      .selectFrom("metadata_matches")
      .innerJoin(
        "media_items",
        "media_items.id",
        "metadata_matches.media_item_id",
      )
      .select(["media_items.id", "media_items.media_root_id as rootId"])
      .where("metadata_matches.state", "=", "ambiguous")
      .where("metadata_matches.looked_up_at", "<=", storedBefore)
      .execute();
    // Checked under write authority: a job registered after this cannot
    // commit until these writes have.
    const factIds = idle(facts, isScanning);
    const candidateIds = idle(candidates, isScanning);
    for (const chunk of parameterChunks(factIds)) {
      await yieldToEventLoop();
      await pinned
        .updateTable("content_facts")
        .set(EXPIRED_FACTS)
        .where("media_item_id", "in", chunk)
        .execute();
      await pinned
        .updateTable("metadata_provider_refs")
        .set({ expired_at: expiredAt })
        .where("media_item_id", "in", chunk)
        .execute();
    }
    for (const chunk of parameterChunks(candidateIds)) {
      await yieldToEventLoop();
      await pinned
        .deleteFrom("metadata_match_candidates")
        .where("media_item_id", "in", chunk)
        .execute();
      await pinned
        .updateTable("metadata_matches")
        .set({ state: "unmatched" })
        .where("media_item_id", "in", chunk)
        .execute();
    }
    return factIds.length + candidateIds.length;
  });
}

/**
 * Stores each answer under write authority: a match replaces the item's
 * TMDB facts and starts its six months again, and a failure records why on
 * the item's reference. An answer lands only while its item is cataloged,
 * still matched to the same TMDB ID with the fetch time read, and outside a
 * busy root, so a rejection, retry, scan, or removal made while TMDB
 * answered always wins. Corrections live in their own table, which this
 * never writes. Returns how many answers landed of each kind.
 */
export async function commitRefreshes(
  db: Kysely<DatabaseSchema>,
  answers: readonly RefreshAnswer[],
  fetchedAt: number,
  isScanning: (rootId: string) => boolean,
): Promise<{ refreshed: number; failed: number }> {
  return runImmediateTransaction(db, async (pinned) => {
    const current = await pinned
      .selectFrom("metadata_provider_refs")
      .innerJoin(
        "media_items",
        "media_items.id",
        "metadata_provider_refs.media_item_id",
      )
      .innerJoin(
        "metadata_matches",
        "metadata_matches.media_item_id",
        "media_items.id",
      )
      .select([
        "media_items.id",
        "metadata_provider_refs.external_kind as externalKind",
        "metadata_provider_refs.external_id as externalId",
        "metadata_provider_refs.fetched_at as fetchedAt",
      ])
      .where(
        "media_items.id",
        "in",
        jsonIdList(answers.map(({ due }) => due.id)),
      )
      .where("media_items.removed_at", "is", null)
      .where("metadata_matches.state", "=", "matched")
      .execute();
    const unchanged = new Set(
      current.map((row) =>
        [row.id, row.externalKind, row.externalId, row.fetchedAt].join(
          "\u0000",
        ),
      ),
    );
    // Checked under write authority, as expiry checks: a job registered
    // after this cannot commit until these writes have.
    const writable = answers.filter(
      ({ due }) =>
        !isScanning(due.rootId) &&
        unchanged.has(
          [due.id, due.externalKind, due.externalId, due.fetchedAt].join(
            "\u0000",
          ),
        ),
    );
    let refreshed = 0;
    for (const { due, lookup } of writable) {
      await yieldToEventLoop();
      if (lookup.kind === "failed") {
        await pinned
          .updateTable("metadata_provider_refs")
          .set({ refresh_error: lookup.reason })
          .where("media_item_id", "=", due.id)
          .execute();
        continue;
      }
      const { media_item_id: _id, ...facts } = contentFactsOf(due.id, lookup);
      await pinned
        .updateTable("content_facts")
        .set(facts)
        .where("media_item_id", "=", due.id)
        .execute();
      await pinned
        .updateTable("metadata_provider_refs")
        .set({ fetched_at: fetchedAt, refresh_error: null, expired_at: null })
        .where("media_item_id", "=", due.id)
        .execute();
      refreshed += 1;
    }
    return { refreshed, failed: writable.length - refreshed };
  });
}

// The IDs of rows whose root has no running scan or retry job.
function idle(
  rows: readonly { id: string; rootId: string }[],
  isScanning: (rootId: string) => boolean,
): string[] {
  return rows.filter((row) => !isScanning(row.rootId)).map((row) => row.id);
}

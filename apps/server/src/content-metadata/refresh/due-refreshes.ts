import {
  lookUpEpisodesInSeries,
  lookUpMovieById,
  type EpisodeLookup,
  type MovieLookup,
  type TmdbClient,
} from "@krazitv/media";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { readMatchEvidence } from "../match-choice/match-evidence.js";

/** One matched item whose TMDB facts are old enough to fetch again. */
interface DueRefresh {
  id: string;
  rootId: string;
  externalKind: "movie" | "tv";
  externalId: number;
  /** The fetch time read, so the commit can tell a newer write happened. */
  fetchedAt: number;
  /** The query that found the match, kept as the refreshed lookup's evidence. */
  query: MovieLookup["query"];
  /** An episode's place in its series; absent for a movie. */
  place?: { season: number; episode: { first: number; last: number } };
}

/** A due item with what TMDB answered for it now. */
export interface RefreshAnswer {
  due: DueRefresh;
  lookup: Extract<MovieLookup | EpisodeLookup, { kind: "matched" }> | Failure;
}

type Failure = { kind: "failed"; reason: string };

/**
 * Reads every matched, cataloged item under an enabled root whose TMDB facts
 * were fetched at or before `fetchedBefore`, oldest first. Expired items are
 * included, so a refresh refills them. A disabled root makes no TMDB calls;
 * its data still expires, and refreshes once the root is enabled again.
 */
export async function readDueRefreshes(
  db: Kysely<DatabaseSchema>,
  fetchedBefore: number,
): Promise<DueRefresh[]> {
  const rows = await db
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
    .innerJoin("content_facts", "content_facts.media_item_id", "media_items.id")
    .innerJoin("media_roots", "media_roots.id", "media_items.media_root_id")
    .select([
      "media_items.id",
      "media_items.media_root_id as rootId",
      "metadata_provider_refs.external_kind as externalKind",
      "metadata_provider_refs.external_id as externalId",
      "metadata_provider_refs.fetched_at as fetchedAt",
      "metadata_matches.evidence",
      "content_facts.season_number as season",
      "content_facts.episode_number as first",
      "content_facts.last_episode_number as last",
    ])
    .where("media_items.removed_at", "is", null)
    .where("media_roots.enabled", "=", 1)
    .where("metadata_matches.state", "=", "matched")
    .where("metadata_provider_refs.fetched_at", "<=", fetchedBefore)
    .orderBy("metadata_provider_refs.fetched_at")
    .orderBy("media_items.path_key")
    .execute();
  return rows.map(({ evidence, season, first, last, ...row }) => ({
    ...row,
    query: readMatchEvidence(evidence).query,
    ...(season === null || first === null
      ? {}
      : { place: { season, episode: { first, last: last ?? first } } }),
  }));
}

/**
 * Fetches each due item's facts by its stored TMDB ID: one call per movie,
 * and for episodes one per series plus one per season, shared by every item
 * of that series. Groups run one after another, so a refresh never crowds
 * scans out of the shared TMDB queue. The caller's abort is rethrown once
 * the running group's requests have settled.
 */
export async function lookUpDue(
  tmdb: TmdbClient,
  apiKey: string,
  due: readonly DueRefresh[],
  signal: AbortSignal,
): Promise<RefreshAnswer[]> {
  const groups = new Map<string, DueRefresh[]>();
  for (const item of due) {
    const key = `${item.externalKind}:${item.externalId}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  const answers: RefreshAnswer[] = [];
  for (const items of groups.values()) {
    const [first] = items;
    if (first === undefined) continue;
    if (first.externalKind === "movie") {
      const lookup = await lookUpMovieById(
        tmdb,
        apiKey,
        first.externalId,
        first.query,
        signal,
      );
      answers.push(
        ...items.map((item) => ({ due: item, lookup: settled(lookup) })),
      );
      continue;
    }
    // An episode without a stored place cannot be fetched again; it fails
    // like a lookup TMDB cannot answer, and expires on schedule.
    const placed = items.filter((item) => item.place !== undefined);
    const lookups = await lookUpEpisodesInSeries(
      tmdb,
      apiKey,
      first.externalId,
      first.query,
      placed.flatMap((item) => item.place ?? []),
      signal,
    );
    answers.push(
      ...items.map((item) => {
        const lookup = lookups[placed.indexOf(item)];
        return {
          due: item,
          lookup: lookup === undefined ? NO_PLACE : settled(lookup),
        };
      }),
    );
  }
  return answers;
}

// Why an episode with no stored season or episode cannot be refreshed.
const NO_PLACE: Failure = {
  kind: "failed",
  reason: "kraziTV has no season and episode to look up",
};

/**
 * Narrows a by-ID lookup to a match or a failure. A series that no longer
 * lists the item's episode answers `ambiguous`, which for an item already
 * matched means TMDB stopped knowing it.
 */
function settled(lookup: MovieLookup | EpisodeLookup): RefreshAnswer["lookup"] {
  if (lookup.kind === "matched" || lookup.kind === "failed") return lookup;
  return { kind: "failed", reason: "TMDB no longer lists this title" };
}

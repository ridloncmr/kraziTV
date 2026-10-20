import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MatchableItem, Recommendation, TmdbKind } from "../contracts.js";
import { listCatalogGroups } from "../criteria/catalog-groups.js";
import { criterionKey } from "../criteria/collection-criterion.js";
import { matchMembership } from "../criteria/match-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { compareNames } from "../name-order.js";

/** A series or franchise needs this many cataloged items to be suggested; tune from real catalogs. */
const RECOMMENDATION_THRESHOLD = 2;

/** The kinds recommended, never genres or tags, with how a reason names them. */
const KINDS: Record<
  TmdbKind,
  { unit: string; describe: (name: string) => string }
> = {
  series: { unit: "episodes", describe: (name) => `the TV series ${name}` },
  franchise: {
    unit: "movies",
    describe: (name) => `the ${name} franchise`,
  },
};

/**
 * Computes recommendations from the catalog on request; nothing stores or
 * maintains them until accepted. Each series or franchise with enough
 * cataloged items is suggested with its reason and members, matched by the
 * same rule a collection's creation applies. One an automatic collection
 * already maintains is never listed, so discovery shows only what is left to
 * decide. By default it lists those undecided and those an acceptance saved
 * as a manual collection; with `dismissed`, those dismissed or accepted and
 * then deleted, which can be restored.
 */
export async function readRecommendations(
  executor: Kysely<DatabaseSchema>,
  dismissed: boolean,
): Promise<Recommendation[]> {
  const items = await readMatchableItems(executor);
  const decisions = new Map(
    (
      await executor
        .selectFrom("collection_recommendation_decisions")
        .select(["criterion_key", "decision", "media_collection_id"])
        .execute()
    ).map((row) => [row.criterion_key, row]),
  );
  // Only automatic collections hold a criterion; conversion to manual clears it.
  const automatic = new Set(
    (
      await executor
        .selectFrom("media_collections")
        .select("criterion")
        .where("criterion", "is not", null)
        .execute()
    ).map((row) => row.criterion),
  );
  const recommendations = (Object.keys(KINDS) as TmdbKind[]).flatMap((kind) =>
    listCatalogGroups(kind, items)
      .filter((group) => group.itemCount >= RECOMMENDATION_THRESHOLD)
      .flatMap((group) => {
        const criterion = { kind, tmdbId: group.tmdbId };
        const key = criterionKey(criterion);
        if (automatic.has(key)) return [];
        const decided = decisions.get(key);
        return [
          toRecommendation(
            criterion,
            group.name,
            items,
            decided?.media_collection_id ?? null,
            decided?.decision ?? null,
          ),
        ];
      }),
  );
  return recommendations
    .filter((recommendation) =>
      dismissed
        ? recommendation.collectionId === null &&
          recommendation.decision !== null
        : recommendation.decision === null ||
          recommendation.collectionId !== null,
    )
    .sort((a, b) =>
      compareNames(
        { name: a.name, id: criterionKey(a.criterion) },
        { name: b.name, id: criterionKey(b.criterion) },
      ),
    );
}

/** Whether `criterion` names a series or franchise the catalog currently recommends. */
export function isRecommended(
  criterion: Recommendation["criterion"],
  items: readonly MatchableItem[],
): { recommended: false } | { recommended: true; name: string } {
  const group = listCatalogGroups(criterion.kind, items).find(
    (candidate) => candidate.tmdbId === criterion.tmdbId,
  );
  return group === undefined || group.itemCount < RECOMMENDATION_THRESHOLD
    ? { recommended: false }
    : { recommended: true, name: group.name };
}

// Builds one recommendation with its reason and the members it would hold.
function toRecommendation(
  criterion: Recommendation["criterion"],
  name: string,
  items: readonly MatchableItem[],
  collectionId: string | null,
  decision: Recommendation["decision"],
): Recommendation {
  const members = matchMembership(criterion, items, [], []).members;
  const { unit, describe } = KINDS[criterion.kind];
  return {
    criterion,
    name,
    reason: `${members.length} cataloged ${unit} of ${describe(name)}`,
    members: members.map((item, position) => ({
      position,
      mediaItemId: item.id,
      title: item.title,
      path: item.path,
      status: item.status,
      durationMs: item.durationMs,
    })),
    seasonCount: criterion.kind === "series" ? countSeasons(members) : null,
    collectionId,
    decision,
  };
}

// Counts the numbered seasons episodes cover; season 0 holds specials, not a season.
function countSeasons(episodes: readonly MatchableItem[]): number {
  return new Set(
    episodes
      .map((episode) => episode.metadata.seasonNumber)
      .filter((season) => season !== null && season > 0),
  ).size;
}

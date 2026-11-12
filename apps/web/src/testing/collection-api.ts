import type {
  CatalogGroup,
  CollectionMember,
  Recommendation,
} from "../http/contracts/collections.js";
import type { MediaItem } from "../http/contracts/media.js";
import { adminFixtures, collectionWith, noMetadata } from "./admin-fixtures.js";
import type { BrowserApi } from "./browser-api.js";

/** Episodes whose numeric path order (2 before 10) differs from plain text order. */
export const episodes: MediaItem[] = [
  {
    id: "e10",
    title: "Episode 10",
    path: "/tv/show/episode 10.mkv",
    status: "available",
    durationMs: 1_500_000,
    probeError: null,
    metadata: noMetadata,
  },
  {
    id: "e2",
    title: "Episode 2",
    path: "/tv/show/episode 2.mkv",
    status: "available",
    durationMs: 1_400_000,
    probeError: null,
    metadata: noMetadata,
  },
];

const fixtureCatalog = [...adminFixtures.media, ...episodes];

/** Cataloged series as the server lists them, by name. */
export const catalogSeries: CatalogGroup[] = [
  { tmdbId: 8592, name: "Parks and Recreation", itemCount: 4 },
  { tmdbId: 2316, name: "The Office", itemCount: 2 },
];

/** Cataloged movie franchises as the server lists them, by name. */
export const catalogFranchises: CatalogGroup[] = [
  { tmdbId: 8091, name: "Alien Collection", itemCount: 4 },
  { tmdbId: 84, name: "Indiana Jones Collection", itemCount: 3 },
];

/** A cataloged item as a collection member at `position`: exactly the server's member projection, so no catalog-only field leaks in. */
function memberOf(
  { id, title, path, status, durationMs }: MediaItem,
  position: number,
): CollectionMember {
  return { position, mediaItemId: id, title, path, status, durationMs };
}

/**
 * An undecided recommendation of `kind` as the server lists it, named
 * for its TMDB ID and holding both fixture episodes; its member count is
 * their number, as the server derives it. Tests override only the facts
 * they assert, such as its decision.
 */
export function recommendation(
  kind: Recommendation["criterion"]["kind"],
  tmdbId: number,
  overrides: Partial<Recommendation> = {},
): Recommendation {
  const members = episodes.map(memberOf);
  return {
    criterion: { kind, tmdbId },
    name: `${kind} ${tmdbId}`,
    reason: `${members.length} cataloged items of ${kind} ${tmdbId}`,
    memberCount: members.length,
    members,
    seasonCount: kind === "series" ? 1 : null,
    collectionId: null,
    decision: null,
    ...overrides,
  };
}

/** An automatic series collection holding both fixture episodes. */
export const officeCollection = collectionWith("office", "The Office", {
  maintenanceMode: "automatic",
  criterion: { kind: "series", tmdbId: 2316 },
  criterionLabel: "The Office",
  maintainedAt: "2026-10-13T12:00:00.000Z",
  maintenanceIncomplete: false,
  memberCount: 2,
});

/**
 * Serves one collection's members, status and the catalog search. Saved order
 * persists across reads and PUT echoes it like the server, so refetches after
 * a save see the committed order. Search leaves excluded IDs out of the items
 * and the total, as the server does; it ignores the text and paging.
 * `extraCatalog` adds items to the fixture catalog that members and search draw
 * from, for a test that needs one the shared catalog leaves out.
 */
export function serveCollection(
  api: BrowserApi,
  id: string,
  memberIds: readonly string[],
  extraCatalog: readonly MediaItem[] = [],
): void {
  const catalog = [...fixtureCatalog, ...extraCatalog];
  let saved = [...memberIds];
  const members = () =>
    saved.map((mediaItemId, position) => {
      const item = catalog.find((media) => media.id === mediaItemId);
      if (!item) throw new Error(`Unknown fixture media ${mediaItemId}`);
      return memberOf(item, position);
    });
  const path = `/media-collections/${id}`;
  api.handle(`${path}/items`, () => api.response(members()));
  api.handle(
    `${path}/items`,
    (request) => {
      saved = (request.body as { mediaItemIds: string[] }).mediaItemIds;
      return api.response(members());
    },
    "PUT",
  );
  api.handle(`${path}/status`, () =>
    api.response({
      schedulable: true,
      memberCount: saved.length,
      schedulableCount: 1,
      missingCount: 0,
      couldNotReadCount: 0,
      tooShortCount: 0,
    }),
  );
  api.handle(
    "/media-items/search",
    (request) => {
      const { excludeIds } = request.body as { excludeIds: string[] };
      const items = catalog.filter((item) => !excludeIds.includes(item.id));
      return api.response({ items, total: items.length });
    },
    "POST",
  );
}

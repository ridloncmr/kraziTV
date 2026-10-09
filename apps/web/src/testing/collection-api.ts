import type { MediaItem } from "../http/contracts.js";
import { adminFixtures, noMetadata } from "./admin-fixtures.js";
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

const catalog = [...adminFixtures.media, ...episodes];

/**
 * Serves one collection's members, status and the catalog search. Saved order
 * persists across reads and PUT echoes it like the server, so refetches after
 * a save see the committed order. Search leaves excluded IDs out of the items
 * and the total, as the server does; it ignores the text and paging.
 */
export function serveCollection(
  api: BrowserApi,
  id: string,
  memberIds: readonly string[],
): void {
  let saved = [...memberIds];
  const members = () =>
    saved.map((mediaItemId, position) => {
      const item = catalog.find((media) => media.id === mediaItemId);
      if (!item) throw new Error(`Unknown fixture media ${mediaItemId}`);
      // Exactly the server's member projection, so no catalog-only field leaks in.
      const { title, path, status, durationMs } = item;
      return { position, mediaItemId, title, path, status, durationMs };
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

import type { ChannelTable } from "./channel-table.js";
import type { MediaCollectionItemTable } from "./media-collection-item-table.js";
import type { MediaCollectionTable } from "./media-collection-table.js";
import type { MediaItemTable } from "./media-item-table.js";
import type { MediaRootTable } from "./media-root-table.js";

// Maps every table name to its row type so Kysely can type-check all queries.
export interface DatabaseSchema {
  media_roots: MediaRootTable;
  media_items: MediaItemTable;
  media_collections: MediaCollectionTable;
  media_collection_items: MediaCollectionItemTable;
  channels: ChannelTable;
}

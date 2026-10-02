import type { MediaItemStatus } from "../database/schema/media-item-table.js";

export interface MediaCollection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** One membership with the item summary needed to judge whether it is schedulable. */
export interface MediaCollectionMember {
  position: number;
  mediaItemId: string;
  title: string;
  status: MediaItemStatus;
  durationMs: number | null;
}

type UnknownMediaItemsResult = {
  kind: "unknown_media_items";
  mediaItemIds: string[];
};

export type CreateMediaCollectionResult =
  { kind: "created"; collection: MediaCollection } | UnknownMediaItemsResult;

export type ReplaceMediaCollectionMembersResult =
  | { kind: "replaced"; members: MediaCollectionMember[] }
  | { kind: "not_found" }
  | UnknownMediaItemsResult;

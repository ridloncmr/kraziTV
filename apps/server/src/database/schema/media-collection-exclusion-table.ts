/**
 * The owner's decision to keep one item out of one automatic collection
 * until restored, whether or not the item still matches. Never a
 * membership row; programming never reads it.
 */
export interface MediaCollectionExclusionTable {
  media_collection_id: string;
  media_item_id: string;
  created_at: number;
}

/** One tag on one media item, at its place in the owner's order of that item's tags. */
export interface MediaItemTagTable {
  media_item_id: string;
  tag_id: string;
  position: number;
}

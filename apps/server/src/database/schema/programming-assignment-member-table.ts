/**
 * One member of an assignment, in saved member order: a collection or a
 * single media item, as an explicit either/or a check enforces. A
 * collection or item is a member of at most one assignment per channel.
 */
export interface ProgrammingAssignmentMemberTable {
  assignment_id: string;
  /** The assignment's channel, so uniqueness per channel is an index. */
  channel_id: string;
  position: number;
  source_kind: "collection" | "media_item";
  media_collection_id: string | null;
  media_item_id: string | null;
  created_at: number;
}

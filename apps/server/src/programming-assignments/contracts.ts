import type { PlaybackMode, StretchSetting } from "@krazitv/krazi-brain";

/** One member an assignment plays: a collection, or one media item. */
export type MemberSource =
  | { kind: "collection"; mediaCollectionId: string }
  | { kind: "media_item"; mediaItemId: string };

/** What the owner saves for one assignment; the API accepts and returns it. */
export interface AssignmentSettings {
  /** Required when a member is a collection; null for single items only. */
  playbackMode: PlaybackMode | null;
  ordinaryStretch: StretchSetting;
  /** Members in saved member order. */
  members: MemberSource[];
}

/** A saved programming source assignment. */
export interface SourceAssignment extends AssignmentSettings {
  id: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
}

/** A member naming a collection or item the catalog does not hold. */
export type UnknownMemberResult =
  | { kind: "unknown_collection"; mediaCollectionId: string }
  | { kind: "unknown_media_item"; mediaItemId: string };

export type CreateAssignmentResult =
  | { kind: "created"; assignment: SourceAssignment }
  | { kind: "limit_reached" }
  | { kind: "channel_not_found" }
  | UnknownMemberResult;

export type UpdateAssignmentResult =
  | { kind: "updated"; assignment: SourceAssignment }
  | { kind: "unchanged"; assignment: SourceAssignment }
  | { kind: "not_found" }
  | UnknownMemberResult;

export type DeleteAssignmentResult =
  { kind: "deleted" } | { kind: "not_found" };

/** A progress reset's outcome; the collection must be one of the assignment's members. */
export type ProgressResetResult = { kind: "reset" } | { kind: "not_assigned" };

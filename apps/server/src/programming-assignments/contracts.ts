import type {
  AssignmentParticipation,
  MarathonSettings,
  PlaybackMode,
  StretchSetting,
} from "@krazitv/krazi-brain";

import type { RuleStretchConflict } from "../programming-rules/contracts.js";

/** One member an assignment plays: a collection, or one media item. */
export type MemberSource =
  | { kind: "collection"; mediaCollectionId: string }
  | { kind: "media_item"; mediaItemId: string };

/** What the owner saves for one assignment; the API accepts and returns it. */
export interface AssignmentSettings {
  /** The owner's name for the show, or null to name it by its members. */
  name: string | null;
  /** In normal rotation, or only while a programming rule selects it. */
  participation: AssignmentParticipation;
  /** Required when a member is a collection; null for single items only. */
  playbackMode: PlaybackMode | null;
  ordinaryStretch: StretchSetting;
  /** A longer turn in the same unit, or null while marathons are disabled. */
  marathonStretch: StretchSetting | null;
  /** Members in saved member order. */
  members: MemberSource[];
}

/**
 * A new assignment's suggested ordinary stretch and the content kind it was
 * chosen from; both null for mixed or unclassified members, so the editor asks.
 */
export interface StretchSuggestion {
  ordinaryStretch: StretchSetting | null;
  contentKind: "movies" | "episodes" | null;
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

/** A member another assignment on the channel already plays. */
export interface MemberAssignedResult {
  kind: "member_assigned";
  member: MemberSource;
  assignmentId: string;
}

export type CreateAssignmentResult =
  | { kind: "created"; assignment: SourceAssignment }
  | { kind: "channel_not_found" }
  | UnknownMemberResult
  | MemberAssignedResult;

/** A member an earlier assignment in the same batch create plays. */
export interface MemberRepeatedResult {
  kind: "member_repeated";
  member: MemberSource;
  /** The request index of the earlier assignment that plays it. */
  assignmentIndex: number;
}

/** Why a batch create wrote nothing: one assignment's refusal. */
export type BatchCreateRefusal =
  Exclude<CreateAssignmentResult, { kind: "created" }> | MemberRepeatedResult;

export type UpdateAssignmentResult =
  | { kind: "updated"; assignment: SourceAssignment }
  /** Only the name changed, which programming never reads. */
  | { kind: "renamed"; assignment: SourceAssignment }
  | { kind: "unchanged"; assignment: SourceAssignment }
  | { kind: "not_found" }
  | UnknownMemberResult
  | MemberAssignedResult
  | RuleStretchConflict;

/** A reorder must name exactly the channel's assignments, each once. */
export type ReorderAssignmentsResult =
  | { kind: "reordered"; assignments: SourceAssignment[] }
  | { kind: "unchanged"; assignments: SourceAssignment[] }
  | { kind: "channel_not_found" }
  | { kind: "mismatch"; assignmentIds: string[] };

export type DeleteAssignmentResult =
  { kind: "deleted" } | { kind: "not_found" };

/** A marathon settings save's outcome, with the settings that now apply. */
export type SaveMarathonSettingsResult =
  | { kind: "saved" | "unchanged"; settings: MarathonSettings }
  | { kind: "channel_not_found" };

/** A progress reset's outcome; the collection must be one of the assignment's members. */
export type ProgressResetResult = { kind: "reset" } | { kind: "not_assigned" };

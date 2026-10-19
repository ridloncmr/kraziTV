import type {
  AssignmentSettings,
  PlaybackMode,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import { type MemberDraft, NEW_MEMBER } from "../assignments/member-rows.js";
import {
  type StretchDraft,
  suggestMarathon,
  toStretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "../assignments/stretch-fields.js";

/** One show's settings as its Properties dialog edits them, before OK or Apply. */
export interface ShowDraft {
  members: MemberDraft[];
  /** Off for a rule-only show, which airs only while a rule selects it. */
  rotates: boolean;
  mode: PlaybackMode;
  /** Per sitting: the show's ordinary stretch. */
  stretch: StretchDraft;
  canMarathon: boolean;
  /** An owner-chosen marathon length, or null to derive one from per sitting. */
  marathonOverride: StretchDraft | null;
}

/** A show nobody has set up yet: one unchosen member, in normal rotation. */
export const NEW_SHOW: ShowDraft = {
  members: [NEW_MEMBER],
  rotates: true,
  mode: "chronological",
  stretch: UNCHOSEN_STRETCH,
  canMarathon: false,
  marathonOverride: null,
};

/**
 * Opens a saved show for editing. A saved marathon length that matches the
 * one derived from per sitting stays derived, so changing per sitting keeps
 * it longer; any other is an override.
 */
export function toShowDraft(assignment: SourceAssignment): ShowDraft {
  const stretch = toStretchDraft(assignment.ordinaryStretch);
  const marathon = assignment.marathonStretch;
  const derived = JSON.stringify(toStretchSetting(suggestMarathon(stretch)));
  return {
    members: assignment.members.map((member) => ({
      kind: member.kind,
      sourceId:
        member.kind === "collection"
          ? member.mediaCollectionId
          : member.mediaItemId,
    })),
    rotates: assignment.participation === "default",
    mode: assignment.playbackMode ?? "chronological",
    stretch,
    canMarathon: marathon !== null,
    marathonOverride:
      marathon === null || JSON.stringify(marathon) === derived
        ? null
        : toStretchDraft(marathon),
  };
}

/** The marathon length a draft saves: its override, or one derived from per sitting. */
export function draftMarathon(draft: ShowDraft): StretchDraft | null {
  if (!draft.canMarathon) return null;
  return draft.marathonOverride ?? suggestMarathon(draft.stretch);
}

/**
 * Builds the assignment a draft describes. Single items alone take no mode
 * and air once a sitting whatever the stretch, so they never marathon.
 */
export function toSettings(draft: ShowDraft): AssignmentSettings {
  const hasCollection = draft.members.some(
    (member) => member.kind === "collection",
  );
  const marathon = draftMarathon(draft);
  return {
    participation: draft.rotates ? "default" : "rule_only",
    playbackMode: hasCollection ? draft.mode : null,
    ordinaryStretch: hasCollection
      ? toStretchSetting(draft.stretch)
      : { kind: "programs", count: 1 },
    marathonStretch:
      hasCollection && marathon !== null ? toStretchSetting(marathon) : null,
    members: draft.members.map((member) =>
      member.kind === "collection"
        ? { kind: "collection", mediaCollectionId: member.sourceId }
        : { kind: "media_item", mediaItemId: member.sourceId },
    ),
  };
}

/** Asks the server to suggest per sitting, and the content kind, for these members. */
export function suggestionPath(members: readonly MemberDraft[]): string {
  const ids = (kind: MemberDraft["kind"]) =>
    members
      .filter((member) => member.kind === kind)
      .map((member) => member.sourceId)
      .join(",");
  const query = new URLSearchParams({
    mediaCollectionIds: ids("collection"),
    mediaItemIds: ids("media_item"),
  });
  return `/programming-assignments/stretch-suggestion?${query}`;
}

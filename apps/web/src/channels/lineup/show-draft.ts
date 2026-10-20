import type {
  AssignmentMember,
  AssignmentSettings,
  PlaybackMode,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import {
  type StretchDraft,
  suggestMarathon,
  toStretchDraft,
  toStretchSetting,
} from "../assignments/stretch-fields.js";

/** One show's settings as its Properties dialog edits them, before OK or Apply. */
export interface ShowDraft {
  /** The owner's name for the show; blank names it by its members. */
  name: string;
  /** Members in saved member order. */
  members: AssignmentMember[];
  /** Off for a rule-only show, which airs only while a rule selects it. */
  rotates: boolean;
  mode: PlaybackMode;
  /** Per sitting: the show's ordinary stretch. */
  stretch: StretchDraft;
  canMarathon: boolean;
  /** An owner-chosen marathon length, or null to derive one from per sitting. */
  marathonOverride: StretchDraft | null;
}

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
    name: assignment.name ?? "",
    members: [...assignment.members],
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
    name: draft.name.trim() || null,
    participation: draft.rotates ? "default" : "rule_only",
    playbackMode: hasCollection ? draft.mode : null,
    ordinaryStretch: hasCollection
      ? toStretchSetting(draft.stretch)
      : { kind: "programs", count: 1 },
    marathonStretch:
      hasCollection && marathon !== null ? toStretchSetting(marathon) : null,
    members: draft.members,
  };
}

/** Asks the server to suggest per sitting, and the content kind, for these members. */
export function suggestionPath(members: readonly AssignmentMember[]): string {
  const ids = (kind: AssignmentMember["kind"]) =>
    members
      .flatMap((member) =>
        member.kind !== kind
          ? []
          : [
              member.kind === "collection"
                ? member.mediaCollectionId
                : member.mediaItemId,
            ],
      )
      .join(",");
  const query = new URLSearchParams({
    mediaCollectionIds: ids("collection"),
    mediaItemIds: ids("media_item"),
  });
  return `/programming-assignments/stretch-suggestion?${query}`;
}

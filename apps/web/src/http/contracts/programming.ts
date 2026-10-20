// Wire shapes of programming source assignments, rules, and their previews.
/** How an assignment orders its collections; mirrors the server's modes. */
export type PlaybackMode = "chronological" | "episode" | "release" | "random";
/** One member an assignment plays: a collection, or one media item. */
export type AssignmentMember =
  | { kind: "collection"; mediaCollectionId: string }
  | { kind: "media_item"; mediaItemId: string };
/** How long one of an assignment's turns runs; airtime in whole minutes. */
export type StretchSetting =
  | { kind: "programs"; count: number }
  | { kind: "airtime"; minutes: number }
  | { kind: "airtime_range"; minMinutes: number; maxMinutes: number };
/** What the owner saves for one programming source assignment. */
export interface AssignmentSettings {
  /** The owner's name for the show, or null to name it by its members. */
  name: string | null;
  /** Rotates normally, or airs only while a programming rule selects it. */
  participation: "default" | "rule_only";
  /** Required with a collection; null for single items only. */
  playbackMode: PlaybackMode | null;
  ordinaryStretch: StretchSetting;
  /** A longer turn in the same unit, or null while marathons are off. */
  marathonStretch: StretchSetting | null;
  members: AssignmentMember[];
}
/** What a rule does to a source's marathon while it wins. */
export type RuleMarathon =
  | { mode: "inherit" }
  | { mode: "disabled" }
  | { mode: "replace"; stretch: StretchSetting };

/** What the owner saves for one programming rule; calendar conditions combine with AND. */
export interface RuleSettings {
  name: string;
  behavior: "join" | "feature";
  /** Higher wins. */
  priority: number;
  dates:
    | { kind: "any" }
    | { kind: "one_off"; startDate: string; endDate: string }
    | { kind: "annual"; startMonthDay: string; endMonthDay: string };
  /** 0 for Sunday through 6 for Saturday; null means every day. */
  weekdays: number[] | null;
  /** Local minutes after midnight; null means the whole day. */
  window: { startMinute: number; endMinute: number } | null;
  sources: {
    assignmentId: string;
    /** Null inherits the assignment's. */
    ordinaryStretch: StretchSetting | null;
    marathon: RuleMarathon;
  }[];
}
/** A saved programming rule. */
export interface ProgrammingRule extends RuleSettings {
  id: string;
}
/** One turn of a programming preview, with what explains it. */
export interface PreviewTurn {
  assignmentId: string | null;
  member:
    | {
        kind: "collection";
        mediaCollectionId: string;
        playbackMode: PlaybackMode;
      }
    | { kind: "media_item"; mediaItemId: string }
    | null;
  roundNumber: number;
  turnIndex: number;
  /** The turn on air when the preview was read, continuing. */
  continues: boolean;
  /** The rule that won when the turn was decided; null for default rotation. */
  winningRuleId: string | null;
  /** Applicable rules passed over before the winner; null for a continued turn. */
  skippedRules: { ruleId: string; reason: string }[] | null;
  /** When the turn was decided: its first program's start. */
  decidedAt: string;
  settingOrigins: {
    ordinary: "assignment" | "rule";
    marathon: "assignment" | "rule" | "disabled";
  };
  startsAt: string | null;
  endsAt: string | null;
  size: { kind: "programs" | "airtime"; value: number } | null;
  marathon: boolean;
  marathonChancePercent: number | null;
  airtimeMinutes: number;
  /** Minutes past an airtime target the turn's whole programs run. */
  overrunMinutes: number | null;
  programs: {
    mediaItemId: string;
    title: string;
    startsAt: string;
    endsAt: string;
  }[];
}
/** The channel's next turns as a regeneration from now would air them. */
export interface ProgrammingPreview {
  /** The programming configuration the preview was generated from. */
  configurationRevision: number;
  turns: PreviewTurn[];
  skips: { assignmentId: string; roundNumber: number; reasons: string[] }[];
}
/** A channel's marathon controls, shared by all its assignments. */
export interface MarathonSettings {
  marathonChancePercent: number;
  marathonMinOrdinaryRounds: number;
}
/** `GET /programming-assignments/stretch-suggestion`: a new show's suggested per sitting and the content kind it rests on; both null for mixed or unclassified members. */
export interface StretchSuggestion {
  ordinaryStretch: StretchSetting | null;
  contentKind: "movies" | "episodes" | null;
}
export interface SourceAssignment extends AssignmentSettings {
  id: string;
}
/** One collection member in the order a mode plays, with the server's flags. */
export interface PreviewMember {
  mediaItemId: string;
  title: string;
  seriesName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  releaseDate: string | null;
  unresolved: boolean;
  startsSeriesGroup: boolean;
  duplicateEpisode: boolean;
}
/** One schedule entry a collection will air next. */
export interface UpcomingSelection {
  id: string;
  mediaItemId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}
/** An assigned collection's order for one mode; random has no order, and only the saved mode has upcoming selections. */
export interface CollectionPreview {
  playbackMode: PlaybackMode;
  ordered: PreviewMember[] | null;
  upcoming: UpcomingSelection[] | null;
}
/** `POST /channels/:id/programming/rebuild`: whether it rebuilt now, and whether the worker stop failed. */
export interface ProgrammingRebuild {
  rebuilt: boolean;
  stopFailed: boolean;
}

/** Wire projections of the public API; internal database and packaging fields stay server-side. */
export interface MediaRoot {
  id: string;
  path: string;
  enabled: boolean;
  lastScannedAt: string | null;
  /**
   * The root's running or latest scan job since the server started, if any.
   * Only `GET /media-roots` carries it; POST and PATCH responses do not.
   */
  scan: ScanStatus | null;
}
/** One level of server folders offered when picking a media root. */
export interface FolderListing {
  /** The listed folder, or null for the server's top level (drives or `/`). */
  path: string | null;
  /** Where Up goes; null means the top level. */
  parent: string | null;
  folders: { name: string; path: string }[];
}
export interface MediaItem {
  id: string;
  title: string;
  path: string;
  status: "available" | "missing" | "probe_failed";
  durationMs: number | null;
  probeError: string | null;
  metadata: ContentMetadata;
}
/** An item's effective content metadata, as the server decided it; unknown facts are null. */
export interface ContentMetadata {
  matchState:
    | "not_looked_up"
    | "unmatched"
    | "ambiguous"
    | "matched"
    | "rejected"
    | "extra";
  lookupError: string | null;
  /** The file's duration changed since it was matched; the match stays. */
  fileChanged: boolean;
  title: string | null;
  seriesName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  lastEpisodeNumber: number | null;
  releaseDate: string | null;
  genres: string[];
  franchiseName: string | null;
  description: string | null;
  /** TMDB's image path, loaded straight from TMDB's image server. */
  posterPath: string | null;
  /** When the TMDB facts were fetched; null when the item has none. */
  refreshedAt: string | null;
  /** Why the last background refresh failed; the match stays. */
  refreshError: string | null;
  /** True once TMDB facts went six months unrefreshed and were dropped. */
  tmdbDataExpired: boolean;
  /** The owner's tags and themes; TMDB never sets them. */
  tags: string[];
  /** Fields showing the owner's correction, which TMDB never changes. */
  correctedFields: CorrectableField[];
}
/** A content fact the owner can correct over what TMDB says. */
export type CorrectableField =
  "title" | "seriesName" | "seasonNumber" | "episodeNumber";
export interface MediaItemPage {
  items: MediaItem[];
  total: number;
}
/** One Review matches step: the item to choose for, and how many items its choice settles. */
export interface ReviewStep {
  mediaItemId: string;
  title: string;
  itemCount: number;
}
/** One TMDB result an ambiguous item offers or a series search finds; unknown facts are null. */
interface MatchCandidate {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
}
/** An ambiguous item's candidates beside the file's own probed duration. */
export interface MatchCandidates {
  kind: "movie" | "series";
  durationMs: number | null;
  candidates: MatchCandidate[];
}
/** `GET /metadata/series-search`: TMDB series whose names match the owner's text. */
export interface SeriesSearch {
  candidates: MatchCandidate[];
}
/**
 * `GET /metadata/track-mappings/:id`: the disc tracks mapped together with
 * one item, in disc-then-track order, and the folder's series and season.
 */
export interface TrackFolder {
  series: string | null;
  season: number | null;
  tracks: {
    mediaItemId: string;
    path: string;
    disc: number | null;
    track: number;
    durationMs: number | null;
  }[];
}
/** One track's episode in a mapping; null skips the track, making it an extra. */
interface TrackRow {
  mediaItemId: string;
  episodeNumber: number | null;
}
/** `GET /metadata/track-mappings/:id/proposal`: proposed rows and the season's episodes. */
export interface TrackProposal {
  rows: TrackRow[];
  episodes: {
    number: number;
    title: string | null;
    runtimeMs: number | null;
  }[];
}
/** What an automatic collection matches on: one TMDB series or movie franchise, one tag, or one genre. */
export type CollectionCriterion =
  | { kind: "series" | "franchise"; tmdbId: number }
  | { kind: "tag"; tagId: string }
  | { kind: "genre"; name: string };
export interface MediaCollection {
  id: string;
  name: string;
  /** `automatic` collections keep their own membership; `manual` ones change only by edits. */
  maintenanceMode: "manual" | "automatic";
  criterion: CollectionCriterion | null;
  /** The criterion's basis as the server names it, such as the series name. */
  criterionLabel: string | null;
  /** When maintenance last brought membership up to date; null when manual. */
  maintainedAt: string | null;
  /** Why the latest maintenance failed; members are as of `maintainedAt`. */
  maintenanceError: string | null;
  /** True when the last update kept or skipped items whose TMDB data expired. */
  maintenanceIncomplete: boolean | null;
}
/** `GET /media-collections`: one listed collection with how many members it includes. */
export interface MediaCollectionSummary extends MediaCollection {
  memberCount: number;
  /** Members whose file is missing; they stay included but cannot air. */
  missingCount: number;
}
/** `GET /media-collections/tags`: one tag on cataloged items a criterion can name. */
export interface CatalogTag {
  tagId: string;
  name: string;
  itemCount: number;
}
/** `GET /media-collections/genres`: one accepted standard genre a criterion can name. */
export interface CatalogGenre {
  name: string;
  itemCount: number;
}
/** `GET /media-collections/series` or `/franchises`: one cataloged group a criterion can name. */
export interface CatalogGroup {
  tmdbId: number;
  name: string;
  itemCount: number;
}
export interface CollectionMember {
  mediaItemId: string;
  title: string;
  path: string;
  status: string;
  durationMs: number | null;
  position: number;
}
/** `GET /media-collections/:id/exclusions`: an item kept out, and whether it would match if restored. */
export interface ExcludedItem extends Omit<CollectionMember, "position"> {
  /** Null while expired TMDB data leaves whether it matches unknown. */
  qualifies: boolean | null;
}
/** `GET /media-collections/recommendations`: one suggested series or franchise collection. */
export interface Recommendation {
  criterion: { kind: "series" | "franchise"; tmdbId: number };
  name: string;
  reason: string;
  memberCount: number;
  members: CollectionMember[];
  /** The collection already made with this criterion, if any. */
  collectionId: string | null;
  decision: "accepted" | "dismissed" | null;
}
export interface CollectionStatus {
  schedulable: boolean;
  schedulableCount: number;
  memberCount: number;
}
export interface Channel {
  id: string;
  number: string;
  name: string;
  enabled: boolean;
}
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
interface ScheduleEntry {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}
/** Planned filler: transmitted, but never a schedule entry or XMLTV programme. */
interface FillerInterval {
  startsAt: string;
  endsAt: string;
  /** When programming resumes, worded by the server in the programming timezone. */
  resumeTime: string;
}
export interface ScheduleWindow {
  scheduleRevision: number;
  entries: ScheduleEntry[];
  fillerIntervals: FillerInterval[];
}
type CurrentItem =
  | {
      type: "program";
      title: string;
      startsAt: string;
      endsAt: string;
      offsetMs?: number;
    }
  | (FillerInterval & { type: "filler"; offsetMs?: number });
export interface ChannelState {
  evaluatedAt: string;
  currentItem: CurrentItem | null;
  nextItem: CurrentItem | null;
  reason?: string;
}
interface ScanSummary {
  discoveredCount: number;
  probedCount: number;
  probeFailedCount: number;
  missingCount: number;
  /** This scan's TMDB lookups by outcome, counted in items. */
  matchedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
  lookupErrorCount: number;
}
/** One scan job's status; every scan dialog state derives from it. */
export interface ScanStatus {
  id: string;
  rootId: string;
  /** A `retry` repeats TMDB lookups only, so it never discovers or probes. */
  kind: "scan" | "retry";
  phase:
    | "discovering"
    | "probing"
    | "enriching"
    | "committing"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  settledCount: number;
  probeFailedCount: number;
  currentPath: string | null;
  /** Items the scan looks up on TMDB; zero when it looked nothing up. */
  lookupCount: number;
  lookedUpCount: number;
  /** The most recently looked-up title; null outside `enriching`. */
  currentTitle: string | null;
  cancelRequested: boolean;
  /** Non-null only when phase is `completed`. */
  summary: ScanSummary | null;
  /** Non-null only when phase is `failed`. */
  error: { code: string; message: string } | null;
}
/**
 * What `POST /metadata/lookup-retries` looks up again: one item, the folder
 * holding one item, or every failed lookup in a root.
 */
export type RetryScope =
  | { scope: "item" | "folder"; mediaItemId: string }
  | { scope: "failed"; mediaRootId: string };
/** What a catalog removal takes out: one root with its items, or listed items. */
export type CatalogRemovalTarget =
  { mediaRootId: string } | { mediaItemIds: string[] };
/** What a removal would do, as `POST /catalog-removals/preview` reports it. */
export interface CatalogRemovalImpact {
  itemCount: number;
  airing: {
    channelId: string;
    channelNumber: string;
    mediaItemId: string;
    title: string;
    endsAt: string;
  }[];
  channelsLeftUnschedulable: { channelId: string; channelNumber: string }[];
  affectedChannelIds: string[];
}
/** What a committed removal did, as `POST /catalog-removals` reports it. */
export interface CatalogRemoval {
  removedItemCount: number;
  finishing: { channelId: string; endsAt: string }[];
  interruptedChannelIds: string[];
  stopFailedChannelIds: string[];
  affectedChannelIds: string[];
}
/** `POST /channels/:id/programming/rebuild`: whether it rebuilt now, and whether the worker stop failed. */
export interface ProgrammingRebuild {
  rebuilt: boolean;
  stopFailed: boolean;
}
export interface PlexSetup {
  tunerBaseUrl: string;
  xmltvUrl: string;
}
/** `/metadata/tmdb-key`: whether a TMDB key is set; the key itself never leaves the server. */
export interface TmdbKeyStatus {
  configured: boolean;
}
/** The account's public profile: enough for a logged-out browser to draw its user tile. */
export interface AccountProfile {
  displayName: string;
  avatarId: string;
}
/** What `GET /auth/state`, `/auth/login`, and `/auth/setup` answer; it decides the screen. */
export interface AuthState {
  setupRequired: boolean;
  account: AccountProfile | null;
  authenticated: boolean;
}

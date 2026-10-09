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
/** One TMDB result an ambiguous item offers; unknown facts are null. */
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
export interface MediaCollection {
  id: string;
  name: string;
}
export interface CollectionMember {
  mediaItemId: string;
  title: string;
  path: string;
  status: string;
  durationMs: number | null;
  position: number;
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
export type BlockSource =
  | {
      kind: "collection";
      mediaCollectionId: string;
      playbackMode: "chronological" | "random";
    }
  | { kind: "media_item"; mediaItemId: string };
export interface ProgrammingBlock {
  id: string;
  source: BlockSource;
}
interface ScheduleEntry {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}
export interface ScheduleWindow {
  scheduleRevision: number;
  entries: ScheduleEntry[];
}
interface CurrentItem {
  title: string;
  startsAt: string;
  endsAt: string;
  offsetMs?: number;
}
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

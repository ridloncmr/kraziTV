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
export interface MediaItem {
  id: string;
  title: string;
  path: string;
  status: "available" | "missing" | "probe_failed";
  durationMs: number | null;
  probeError: string | null;
}
export interface MediaItemPage {
  items: MediaItem[];
  total: number;
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
}
/** One scan job's status; every scan dialog state derives from it. */
export interface ScanStatus {
  id: string;
  rootId: string;
  phase:
    | "discovering"
    | "probing"
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
  cancelRequested: boolean;
  /** Non-null only when phase is `completed`. */
  summary: ScanSummary | null;
  /** Non-null only when phase is `failed`. */
  error: { code: string; message: string } | null;
}
export interface PlexSetup {
  tunerBaseUrl: string;
  xmltvUrl: string;
}

/** Wire projections of the public API; internal database and packaging fields stay server-side. */
export interface MediaRoot {
  id: string;
  path: string;
  enabled: boolean;
  lastScannedAt: string | null;
}
export interface MediaItem {
  id: string;
  title: string;
  path: string;
  status: "available" | "missing" | "probe_failed";
  durationMs: number | null;
  probeError: string | null;
}
export interface MediaCollection {
  id: string;
  name: string;
}
export interface CollectionMember {
  mediaItemId: string;
  title: string;
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
export interface ScanSummary {
  discoveredCount: number;
  probedCount: number;
  probeFailedCount: number;
  missingCount: number;
}
export interface PlexSetup {
  tunerBaseUrl: string;
  xmltvUrl: string;
}

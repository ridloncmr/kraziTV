// Wire shapes of channels, their schedule window, and channel state.
export interface Channel {
  id: string;
  number: string;
  name: string;
  enabled: boolean;
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

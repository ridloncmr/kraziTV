// Wire shapes of channels, their schedule window, and channel state.
export interface Channel {
  id: string;
  number: string;
  name: string;
  enabled: boolean;
}
/**
 * How an entry reads as a program, worded by the server from the media's
 * content facts: an episode under its series title, a movie under its TMDB
 * title, or media without facts by the entry's own title alone.
 */
export interface GuideProgram {
  title: string;
  /** An episode's own title. */
  subTitle: string | null;
  description: string | null;
  /** `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. */
  releaseDate: string | null;
  kind: "movie" | "episode" | null;
  genres: string[];
  /** A TMDB poster at guide width, loaded from TMDB. */
  posterUrl: string | null;
  episode: {
    season: number;
    episode: number;
    lastEpisode: number | null;
  } | null;
}
interface ScheduleEntry {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  program: GuideProgram;
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
  /** Why nothing is on air, present only when `currentItem` is null. */
  reason?: "schedule_gap" | "media_unavailable";
}

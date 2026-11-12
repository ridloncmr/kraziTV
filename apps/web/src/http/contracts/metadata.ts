// Wire shapes of the content-metadata routes under `/metadata`.
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
/**
 * `GET /metadata/series-search` and `GET /metadata/matches/:id/search`: the
 * TMDB titles the owner's own words found.
 */
export interface CandidateSearch {
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
/**
 * What `POST /metadata/lookup-retries` looks up as one root's scan job: one
 * item, the folder holding one item, or a root's outstanding files, never
 * looked up or whose lookup failed. Without `mediaRootId` the server starts
 * one job per root and answers with counts instead of a scan status, so
 * that form is not a scope this job-following request sends.
 */
export type RetryScope =
  | { scope: "item" | "folder"; mediaItemId: string }
  | { scope: "outstanding"; mediaRootId: string };
/**
 * `POST /metadata/lookup-retries` with `{ scope: "outstanding" }` and no
 * root: one job started on every enabled, idle root with outstanding files.
 */
export interface EveryRootLookup {
  /** The files the started jobs look up, summed over their roots. */
  lookupCount: number;
  /** Roots skipped because a scan or lookup was already running there. */
  busyRootCount: number;
}
/** `/metadata/tmdb-key`: whether a TMDB key is set; the key itself never leaves the server. */
export interface TmdbKeyStatus {
  configured: boolean;
}

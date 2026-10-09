import type { EpisodeLookup, MovieLookup, PathHints } from "@krazitv/media";

/**
 * One item's match decision on its way to the database: what a scan's
 * enrichment decided, or what the owner chose. An extra is recorded without a
 * lookup; every other record is one lookup's outcome.
 */
export type MetadataMatchRecord = { pathKey: string; hints: PathHints } & (
  | { kind: "extra" }
  | {
      kind: "looked_up";
      lookedUpAt: number;
      /**
       * The probed duration, kept with a match to flag later file changes;
       * null when a choice is made for a file that no longer probes.
       */
      durationMs: number | null;
      lookup: MovieLookup | EpisodeLookup;
      /** True when the owner chose this match among candidates. */
      chosen?: true;
    }
);

/**
 * One Review matches step: the item to choose for, and how many items the
 * choice settles, since a series choice resolves its whole series folder.
 */
export interface ReviewStep {
  mediaItemId: string;
  /** The series or movie name the step asks about. */
  title: string;
  itemCount: number;
}

/** One TMDB result an ambiguous item offers, as the candidate choice shows it. */
interface MatchCandidate {
  tmdbId: number;
  title: string;
  /** First release as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. */
  releaseDate: string | null;
  posterPath: string | null;
}

/** An ambiguous item's candidates beside the file's own probed duration. */
export interface MatchCandidates {
  kind: "movie" | "series";
  durationMs: number | null;
  candidates: MatchCandidate[];
}

/** Why a choice, rejection, or candidate read changed nothing. */
export type MatchChoiceRefusal =
  | { kind: "item_not_found" }
  /** The item's decision is not the ambiguous one read, so a choice would overwrite a newer one. */
  | { kind: "not_ambiguous" }
  | { kind: "candidate_not_offered" }
  | { kind: "tmdb_key_missing" }
  | { kind: "lookup_failed"; reason: string }
  /** The chosen series has no episode where the file's hints place it. */
  | { kind: "episode_not_in_series" }
  | { kind: "not_rejectable" }
  | { kind: "not_rejected" };

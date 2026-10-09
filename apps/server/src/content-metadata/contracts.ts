import type { EpisodeLookup, MovieLookup, PathHints } from "@krazitv/media";

import type { MetadataMatchTable } from "../database/schema/metadata-match-table.js";

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

/**
 * The owner's change to one item's corrections: a value corrects a field,
 * null clears its correction so the provider's fact shows again, and an
 * absent field is left as it is. Tags, when given, replace the item's tags.
 */
export interface CorrectionChange {
  title?: string | null;
  seriesName?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  tags?: string[];
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

/**
 * Which cataloged items a lookup retry covers: one item, every item in the
 * folder holding that item and the folders below it, or every item in a root
 * whose last lookup failed.
 */
export type RetryScope =
  | { scope: "item" | "folder"; mediaItemId: string }
  | { scope: "failed"; mediaRootId: string };

/** An item's match decision as a retry read it; null when it had none. */
export type DecisionRead = {
  state: MetadataMatchTable["state"];
  lookedUpAt: number | null;
} | null;

/** One available, non-extra item a retry looks up, with the decision it read. */
export interface RetryItem {
  id: string;
  path: string;
  pathKey: string;
  durationMs: number;
  read: DecisionRead;
}

/** One retry lookup on its way to the database, with the decision it replaces. */
export interface RetryEntry {
  id: string;
  record: MetadataMatchRecord;
  read: DecisionRead;
}

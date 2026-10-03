import type { PlayoutEntry } from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/**
 * A playout entry with its channel sequence number, which only the server
 * needs: it orders the following-items query, and kraziBrain never sees it.
 */
export interface SequencedPlayoutEntry {
  entry: PlayoutEntry;
  sequenceNumber: number;
}

/** How far a snapshot requires the channel's schedule coverage to reach. */
export type CoverageRequirement =
  /** A full horizon past the effective current time, or `through` when later. */
  | { kind: "horizon"; through?: number | undefined }
  /** An exact target from an earlier snapshot, so a retry never recomputes it. */
  | { kind: "target"; target: number }
  /** Serve whatever entries exist. */
  | { kind: "none" };

export interface PlayoutSnapshotOptions {
  coverage: CoverageRequirement;
  /**
   * Runs inside the snapshot right after the revision read, so a test can
   * pause the reader once its SQLite read snapshot is fixed.
   */
  afterRevisionRead?: (() => void | Promise<void>) | undefined;
}

/**
 * Reads the snapshot's playout rows through its transaction, given the
 * revision they belong to.
 */
export type PlayoutSnapshotRead<T> = (
  trx: Kysely<DatabaseSchema>,
  scheduleRevision: number,
) => Promise<T>;

/**
 * What one snapshot found. `coverage_needed` carries the target a coverage
 * write must reach before a retry; nothing is ever written inside a snapshot.
 */
export type PlayoutSnapshot<T> =
  | { kind: "not_found" }
  | { kind: "disabled" }
  | { kind: "coverage_needed"; target: number }
  | { kind: "through_out_of_range"; latestThrough: number }
  | { kind: "ok"; scheduleRevision: number; value: T };

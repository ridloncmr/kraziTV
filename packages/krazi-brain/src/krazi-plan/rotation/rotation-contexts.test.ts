import { describe, expect, it } from "vitest";

import { collectionAssignment } from "../../testing/programming-assignments.js";
import { scheduleMedia } from "../../testing/schedule-media.js";
import type {
  ProgrammingAssignment,
  RotationCheckpoint,
  RotationScope,
} from "../contracts.js";
import {
  enterContext,
  leaveContext,
  reconcileRound,
  type RotationState,
} from "./rotation-contexts.js";

const SEED = { programmingSeed: 0x1234abcd, rebuildCount: 0 };
const MOVIE = scheduleMedia("movie", { durationMs: 90 * 60_000 });

const defaults = ["a", "b", "c", "d", "e", "f"].map((id) =>
  collectionAssignment(id, `c-${id}`, [MOVIE]),
);
const christmas = collectionAssignment("xmas", "c-xmas", [MOVIE], {
  participation: "rule_only",
});

// The default context with or without the December join's source.
function scope(withChristmas: boolean): RotationScope {
  const eligible: ProgrammingAssignment[] = withChristmas
    ? [...defaults, christmas]
    : defaults;
  return {
    contextKey: "default",
    eligible,
    ruleDriven: new Set(withChristmas ? ["xmas"] : []),
  };
}

// A round under way: two served, four pending.
const UNDER_WAY: RotationState = {
  roundNumber: 4,
  pending: ["e", "b", "f", "d"],
  served: ["c", "a"],
  skipped: [],
  unservedRemoved: [],
  marathonOpportunity: null,
  roundCommittedProgram: true,
  lastAiredAssignmentId: "a",
  nextMemberPositions: {},
  ordinaryRoundsSinceMarathon: null,
  rebuildCount: 0,
};

describe("reconcileRound", () => {
  it("inserts a newly eligible source into the pending turns without reordering them", () => {
    const joined = reconcileRound(UNDER_WAY, scope(true), SEED, 4);

    expect(joined.pending).toHaveLength(5);
    expect(joined.pending.filter((id) => id !== "xmas")).toEqual(
      UNDER_WAY.pending,
    );
    // Reproducible from the round and the source alone.
    expect(reconcileRound(UNDER_WAY, scope(true), SEED, 4)).toEqual(joined);
  });

  it("draws the insertion position from the round and the source", () => {
    const positions = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((roundNumber) =>
        reconcileRound(
          { ...UNDER_WAY, roundNumber },
          scope(true),
          SEED,
          roundNumber,
        ).pending.indexOf("xmas"),
      ),
    );

    expect(positions.size).toBeGreaterThan(1);
  });

  it("removes a source that loses eligibility, and gives its turn back if it returns that round", () => {
    const joined = reconcileRound(UNDER_WAY, scope(true), SEED, 4);
    const left = reconcileRound(joined, scope(false), SEED, 4);

    expect(left.pending).toEqual(UNDER_WAY.pending);
    expect(left.unservedRemoved).toEqual(["xmas"]);

    const back = reconcileRound(left, scope(true), SEED, 4);
    expect(back.pending.filter((id) => id !== "xmas")).toEqual(
      UNDER_WAY.pending,
    );
    expect(back.pending).toContain("xmas");
    expect(back.unservedRemoved).toEqual([]);
  });

  it("never gives a served or skipped source another turn by leaving and rejoining", () => {
    for (const round of [
      { ...UNDER_WAY, served: [...UNDER_WAY.served, "xmas"] },
      { ...UNDER_WAY, skipped: ["xmas"] },
    ]) {
      const left = reconcileRound(round, scope(false), SEED, 4);
      expect(reconcileRound(left, scope(true), SEED, 4).pending).toEqual(
        UNDER_WAY.pending,
      );
    }
  });

  it("leaves a default assignment added mid-round for the next round", () => {
    const added = collectionAssignment("g", "c-g", [MOVIE]);

    const reconciled = reconcileRound(
      UNDER_WAY,
      {
        contextKey: "default",
        eligible: [...defaults, added],
        ruleDriven: new Set(),
      },
      SEED,
      4,
    );

    expect(reconciled.pending).toEqual(UNDER_WAY.pending);
  });

  it("joins nothing into a round with no turns left, which the next round includes", () => {
    const spent = { ...UNDER_WAY, pending: [], served: ["a", "b", "c"] };

    expect(reconcileRound(spent, scope(true), SEED, 4).pending).toEqual([]);
  });
});

describe("enterContext and leaveContext", () => {
  const checkpoint: RotationCheckpoint = {
    activeContext: "default",
    contexts: {
      default: {
        roundNumber: 2,
        pending: ["a"],
        served: ["b"],
        skipped: [],
        unservedRemoved: [],
        marathonOpportunity: null,
        roundCommittedProgram: true,
      },
    },
    lastAiredAssignmentId: "b",
    nextMemberPositions: { b: 1 },
    ordinaryRoundsSinceMarathon: 3,
    rebuildCount: 0,
  };

  it("starts a context it has never entered before its first round", () => {
    expect(enterContext(checkpoint, "rule:fridays")).toMatchObject({
      roundNumber: 0,
      pending: [],
      lastAiredAssignmentId: "b",
      ordinaryRoundsSinceMarathon: 3,
    });
  });

  it("keeps other contexts' rounds when one is stored back", () => {
    const entered = enterContext(checkpoint, "rule:fridays");
    const stored = leaveContext(
      { ...entered, roundNumber: 1, pending: ["x"] },
      "rule:fridays",
      checkpoint,
    );

    expect(stored.activeContext).toBe("rule:fridays");
    expect(stored.contexts.default).toEqual(checkpoint.contexts.default);
    expect(enterContext(stored, "default")).toMatchObject({
      roundNumber: 2,
      pending: ["a"],
    });
    expect(stored.contexts["rule:fridays"]?.pending).toEqual(["x"]);
  });
});

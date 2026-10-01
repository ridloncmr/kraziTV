import { describe, expect, it, vi } from "vitest";

import { SignalError, type TransitionCandidate } from "./index.js";
import { FakeClock } from "./testing/fake-clock.js";
import { InMemoryTransitionCoordinator } from "./testing/in-memory-transition-coordinator.js";

const candidate: TransitionCandidate = {
  channelId: "comedy",
  scheduleEntryId: "entry-2",
  scheduleRevision: 7,
};

/** Arranges one schedule revision whose entry covers the boundary time 1_000. */
const coordinatorWith = (
  revision: number,
  scheduleEntryId: string,
): InMemoryTransitionCoordinator => {
  const coordinator = new InMemoryTransitionCoordinator(new FakeClock(1_000));
  coordinator.setSchedule("comedy", revision, [
    { scheduleEntryId, startsAt: 0, endsAt: 2_000 },
  ]);
  return coordinator;
};

describe("TransitionCoordinator contract", () => {
  it("commits a candidate that is still current", async () => {
    const commit = vi.fn();
    const coordinator = coordinatorWith(7, "entry-2");

    await expect(
      coordinator.commitPreparedTransition(candidate, commit),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });

  it.each([
    ["revision", 8, "entry-2"],
    ["covering entry", 7, "entry-3"],
  ])(
    "does not commit a candidate whose %s changed",
    async (_change, revision, scheduleEntryId) => {
      const commit = vi.fn();
      const coordinator = coordinatorWith(revision, scheduleEntryId);

      await expect(
        coordinator.commitPreparedTransition(candidate, commit),
      ).resolves.toBe("stale");
      expect(commit).not.toHaveBeenCalled();
    },
  );
});

describe("SignalError", () => {
  it("carries a provider-neutral failure code and safe details", () => {
    const error = new SignalError(
      "channel_disabled",
      "Channel comedy is disabled",
      { channelId: "comedy" },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SignalError");
    expect(error.code).toBe("channel_disabled");
    expect(error.details).toEqual({ channelId: "comedy" });
  });
});

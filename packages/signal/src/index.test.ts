import { describe, expect, it, vi } from "vitest";

import {
  SignalError,
  type TransitionCandidate,
  type TransitionCoordinator,
} from "./index.js";

class InMemoryTransitionCoordinator implements TransitionCoordinator {
  constructor(
    private readonly currentEntryId: string,
    private readonly currentRevision: number,
  ) {}

  async commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale"> {
    if (
      candidate.scheduleEntryId !== this.currentEntryId ||
      candidate.scheduleRevision !== this.currentRevision
    ) {
      return "stale";
    }

    commit();
    return "committed";
  }
}

const candidate: TransitionCandidate = {
  channelId: "comedy",
  scheduleEntryId: "entry-2",
  scheduleRevision: 7,
};

describe("TransitionCoordinator contract", () => {
  it("commits a candidate that is still current", async () => {
    const commit = vi.fn();
    const coordinator = new InMemoryTransitionCoordinator("entry-2", 7);

    await expect(
      coordinator.commitPreparedTransition(candidate, commit),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("does not commit a stale candidate", async () => {
    const commit = vi.fn();
    const coordinator = new InMemoryTransitionCoordinator("entry-3", 8);

    await expect(
      coordinator.commitPreparedTransition(candidate, commit),
    ).resolves.toBe("stale");
    expect(commit).not.toHaveBeenCalled();
  });
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

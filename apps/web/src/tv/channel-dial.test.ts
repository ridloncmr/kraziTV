import { describe, expect, it } from "vitest";
import type { Channel } from "../http/contracts/channels.js";
import { startingChannel, stepChannel } from "./channel-dial.js";

const channel = (id: string, enabled = true): Channel => ({
  id,
  number: id,
  name: `Channel ${id}`,
  enabled,
});
const lineup = [channel("2"), channel("3", false), channel("4"), channel("5")];

describe("startingChannel", () => {
  it("starts on the preferred channel while it is enabled", () => {
    expect(startingChannel(lineup, ["4"])?.id).toBe("4");
  });

  it("starts on the first enabled channel when the preferred one is disabled or gone", () => {
    expect(startingChannel(lineup, ["3"])?.id).toBe("2");
    expect(startingChannel(lineup, ["9"])?.id).toBe("2");
    expect(startingChannel(lineup, [undefined])?.id).toBe("2");
  });

  it("keeps the channel on screen when the one asked for is not listed yet", () => {
    expect(startingChannel(lineup, ["9", "5"])?.id).toBe("5");
  });

  it("starts on nothing when every channel is disabled", () => {
    expect(startingChannel([channel("3", false)], [])).toBeUndefined();
  });
});

describe("stepChannel", () => {
  it("skips disabled channels and wraps at either end", () => {
    expect(stepChannel(lineup, "2", 1)?.id).toBe("4");
    expect(stepChannel(lineup, "4", -1)?.id).toBe("2");
    expect(stepChannel(lineup, "5", 1)?.id).toBe("2");
    expect(stepChannel(lineup, "2", -1)?.id).toBe("5");
  });

  it("counts from a channel's place after it is disabled", () => {
    expect(stepChannel(lineup, "3", 1)?.id).toBe("4");
    expect(stepChannel(lineup, "3", -1)?.id).toBe("2");
  });

  it("starts at an end with no current channel, and stays put with nowhere to go", () => {
    expect(stepChannel(lineup, undefined, 1)?.id).toBe("2");
    expect(stepChannel(lineup, undefined, -1)?.id).toBe("5");
    expect(stepChannel([channel("2")], "2", 1)).toBeUndefined();
  });
});

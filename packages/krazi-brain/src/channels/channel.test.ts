import { describe, expect, it } from "vitest";

import { describeChannel } from "./channel.js";
import { parseChannelNumber } from "./channel-number.js";

describe("describeChannel", () => {
  it("formats the channel number and name", () => {
    const number = parseChannelNumber("69.1");
    if (number === undefined) {
      throw new Error("69.1 should be canonical");
    }

    expect(
      describeChannel({
        id: "comedy",
        number,
        name: "Krazi Comedy",
        enabled: true,
      }),
    ).toBe("69.1 - Krazi Comedy");
  });
});

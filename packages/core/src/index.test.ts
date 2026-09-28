import { describe, expect, it } from "vitest";

import { describeChannel } from "./index.js";

describe("describeChannel", () => {
  it("formats the channel number and name", () => {
    expect(
      describeChannel({ id: "comedy", number: "69.1", name: "Krazi Comedy" }),
    ).toBe("69.1 - Krazi Comedy");
  });
});

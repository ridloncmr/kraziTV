import { describe, expect, it } from "vitest";

import {
  compareChannelNumbers,
  parseChannelNumber,
  type ChannelNumber,
} from "./channel-number.js";

/** Parses test inputs that must be canonical, failing loudly if one is not. */
function channelNumber(input: string): ChannelNumber {
  const parsed = parseChannelNumber(input);
  if (parsed === undefined) {
    throw new Error(`Test input ${JSON.stringify(input)} is not canonical`);
  }
  return parsed;
}

/** Sorts canonical inputs with the comparator under test. */
function sortChannelNumbers(inputs: string[]): string[] {
  return inputs.map(channelNumber).sort(compareChannelNumbers);
}

describe("parseChannelNumber", () => {
  it.each(["69", "69.1", "1", "10.25", "1234567890123456789012"])(
    "accepts canonical number %j",
    (input) => {
      expect(parseChannelNumber(input)).toBe(input);
    },
  );

  it.each([
    ["empty input", ""],
    ["leading whitespace", " 69"],
    ["trailing whitespace", "69 "],
    ["inner whitespace", "69. 1"],
    ["plus sign", "+69"],
    ["minus sign", "-69"],
    ["leading zero", "069"],
    ["zero major", "0"],
    ["zero major with subchannel", "0.1"],
    ["zero subchannel", "69.0"],
    ["leading-zero subchannel", "69.01"],
    ["multiple separators", "69.1.2"],
    ["trailing separator", "69."],
    ["leading separator", ".1"],
    ["non-digit", "69a"],
    ["non-ASCII digit", "٦٩"],
  ])("rejects %s", (_reason, input) => {
    expect(parseChannelNumber(input)).toBeUndefined();
  });
});

describe("compareChannelNumbers", () => {
  it("orders by major number, then subchannel, with no subchannel first", () => {
    expect(sortChannelNumbers(["11", "10.2", "2", "10.1", "10"])).toEqual([
      "2",
      "10",
      "10.1",
      "10.2",
      "11",
    ]);
  });

  it("orders subchannels numerically", () => {
    expect(sortChannelNumbers(["5.10", "5.9"])).toEqual(["5.9", "5.10"]);
  });

  it("orders majors beyond safe integer precision exactly", () => {
    expect(
      sortChannelNumbers(["9007199254740993", "9007199254740992"]),
    ).toEqual(["9007199254740992", "9007199254740993"]);
  });

  it("treats equal numbers as equal", () => {
    expect(
      compareChannelNumbers(channelNumber("69.1"), channelNumber("69.1")),
    ).toBe(0);
  });

  it("accepts only parsed channel numbers", () => {
    // @ts-expect-error A raw string has not been checked by parseChannelNumber.
    expect(compareChannelNumbers("069", "70")).toBeTypeOf("number");
  });
});

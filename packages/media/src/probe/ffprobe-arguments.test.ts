import { describe, expect, it } from "vitest";

import { buildFfprobeArguments } from "./ffprobe-arguments.js";

describe("buildFfprobeArguments", () => {
  it("requests JSON with only the selected format and stream fields", () => {
    expect(buildFfprobeArguments("/media/show.mkv")).toEqual([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_entries",
      "format=duration:stream=codec_type:stream_disposition=attached_pic",
      "-i",
      "/media/show.mkv",
    ]);
  });

  it("passes paths with spaces and shell metacharacters as one literal argument", () => {
    const path = String.raw`C:\Media\Tom & Jerry; "Pilot" $(rm).mkv`;
    const args = buildFfprobeArguments(path);
    expect(args.at(-1)).toBe(path);
    expect(args.filter((arg) => arg.includes("Jerry"))).toHaveLength(1);
  });
});

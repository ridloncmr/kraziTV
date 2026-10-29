import { describe, expect, it } from "vitest";

import { defaultFillerFontFile } from "./default-filler-font.js";

describe("defaultFillerFontFile", () => {
  it("names Arial under the Windows directory with forward slashes", () => {
    expect(defaultFillerFontFile("win32", "D:\\WINDOWS")).toBe(
      "D:/WINDOWS/Fonts/arial.ttf",
    );
  });

  it("leaves other platforms to fontconfig", () => {
    expect(defaultFillerFontFile("linux")).toBeUndefined();
  });
});

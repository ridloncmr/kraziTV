import { describe, expect, it } from "vitest";

import { escapeXml } from "./escape-xml.js";

describe("escapeXml", () => {
  it("escapes all five XML metacharacters, ampersands first", () => {
    expect(escapeXml(`Tom & Jerry's <Best> "Hits" &amp;`)).toBe(
      "Tom &amp; Jerry&apos;s &lt;Best&gt; &quot;Hits&quot; &amp;amp;",
    );
  });

  it("leaves plain text unchanged", () => {
    expect(escapeXml("Krazi Comedy 69.1")).toBe("Krazi Comedy 69.1");
  });
});

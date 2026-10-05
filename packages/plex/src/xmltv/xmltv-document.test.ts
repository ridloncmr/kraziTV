import { describe, expect, it } from "vitest";

import { formatXmltv } from "./xmltv-document.js";

describe("formatXmltv", () => {
  it("declares each channel with a .krazitv ID and display names name-then-number", () => {
    const xml = formatXmltv([
      { id: "uuid-a", number: "2", name: "Two" },
      { id: "uuid-b", number: "69.1", name: "Sub" },
    ]);

    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n/);
    expect(xml).toContain(
      [
        '  <channel id="uuid-a.krazitv">',
        "    <display-name>Two</display-name>",
        "    <display-name>2</display-name>",
        "  </channel>",
        '  <channel id="uuid-b.krazitv">',
        "    <display-name>Sub</display-name>",
        "    <display-name>69.1</display-name>",
        "  </channel>",
      ].join("\n"),
    );
    expect(xml.trimEnd()).toMatch(/<\/tv>$/);
  });

  it("escapes display names and channel IDs", () => {
    const xml = formatXmltv([
      {
        id: `odd"id`,
        number: "7",
        name: `Tom & Jerry's <Best> "Hits"`,
      },
    ]);

    expect(xml).toContain('<channel id="odd&quot;id.krazitv">');
    expect(xml).toContain(
      "<display-name>Tom &amp; Jerry&apos;s &lt;Best&gt; &quot;Hits&quot;</display-name>",
    );
  });

  it("emits an empty guide when no channel is enabled", () => {
    expect(formatXmltv([])).toContain('<tv generator-info-name="kraziTV">');
  });
});

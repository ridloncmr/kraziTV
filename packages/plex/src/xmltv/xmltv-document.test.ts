import { describe, expect, it } from "vitest";

import { formatXmltv } from "./xmltv-document.js";

const T0 = Date.parse("2026-10-05T12:00:00.000Z");
const MINUTE = 60_000;

describe("formatXmltv", () => {
  it("declares each channel with a .krazitv ID and display names name-then-number", () => {
    const xml = formatXmltv([
      { id: "uuid-a", number: "2", name: "Two", programmes: [] },
      { id: "uuid-b", number: "69.1", name: "Sub", programmes: [] },
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
        programmes: [],
      },
    ]);

    expect(xml).toContain('<channel id="odd&quot;id.krazitv">');
    expect(xml).toContain(
      "<display-name>Tom &amp; Jerry&apos;s &lt;Best&gt; &quot;Hits&quot;</display-name>",
    );
  });

  it("lists programmes after every channel, each with start, stop, channel, and escaped title", () => {
    const xml = formatXmltv([
      {
        id: "uuid-a",
        number: "2",
        name: "Two",
        programmes: [
          { startsAt: T0, endsAt: T0 + 22 * MINUTE, title: "Pilot" },
          {
            startsAt: T0 + 22 * MINUTE,
            endsAt: T0 + 45 * MINUTE,
            title: "Fish & <Chips>",
          },
        ],
      },
      { id: "uuid-b", number: "3", name: "Three", programmes: [] },
    ]);

    expect(xml).toContain(
      [
        '  <channel id="uuid-b.krazitv">',
        "    <display-name>Three</display-name>",
        "    <display-name>3</display-name>",
        "  </channel>",
        '  <programme start="20261005120000 +0000" stop="20261005122200 +0000" channel="uuid-a.krazitv">',
        "    <title>Pilot</title>",
        "  </programme>",
        '  <programme start="20261005122200 +0000" stop="20261005124500 +0000" channel="uuid-a.krazitv">',
        "    <title>Fish &amp; &lt;Chips&gt;</title>",
        "  </programme>",
        "</tv>",
      ].join("\n"),
    );
  });

  it("emits an empty guide when no channel is enabled", () => {
    expect(formatXmltv([])).toContain('<tv generator-info-name="kraziTV">');
  });
});

// The web build strips license comments, so THIRD_PARTY_NOTICES.md carries
// the notices for every library the browser bundle ships. This fails when a
// runtime dependency is added to the web app without one.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("third-party notices", () => {
  it("name every runtime dependency of the web app", () => {
    const { dependencies = {} } = JSON.parse(read("apps/web/package.json"));
    const notices = read("THIRD_PARTY_NOTICES.md");
    const section = notices.slice(
      notices.indexOf("## Web App Libraries"),
      notices.indexOf("\n## ", notices.indexOf("## Web App Libraries") + 1),
    );
    const names = {
      react: "React",
      "react-dom": "ReactDOM",
    };

    const missing = Object.keys(dependencies).filter(
      (name) => !section.includes(names[name] ?? name),
    );

    expect(missing).toEqual([]);
  });
});

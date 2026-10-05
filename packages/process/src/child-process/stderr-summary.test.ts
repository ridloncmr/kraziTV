import { describe, expect, it } from "vitest";

import { sanitizeDiagnosticText, summarizeStderr } from "./stderr-summary.js";

describe("sanitizeDiagnosticText", () => {
  it("strips terminal escape sequences and control characters", () => {
    expect(
      sanitizeDiagnosticText(
        "bad \u001b[1;31mred\u001b[0m \u001b]0;title\u0007file\u0000\r\nnext",
      ),
    ).toBe("bad red file next");
  });
});

describe("summarizeStderr", () => {
  it("returns the last meaningful line", () => {
    const tail = Buffer.from("first warning\r\nlast failure\n\n  \n");

    expect(summarizeStderr(tail)).toBe("last failure");
  });

  it("returns undefined when stderr holds nothing printable", () => {
    expect(summarizeStderr(Buffer.from("\n\u001b[0m\n"))).toBeUndefined();
  });

  it("replaces every redacted value, even one containing spaces", () => {
    const path = "C:/private/my  media/movie.mkv";
    const tail = Buffer.from(`${path}: Invalid data found (${path})\n`);

    expect(summarizeStderr(tail, [path])).toBe(
      "[redacted]: Invalid data found ([redacted])",
    );
  });

  it("bounds the summary so a runaway line cannot flood a log", () => {
    const summary = summarizeStderr(Buffer.from("x".repeat(10_000)));

    expect(summary).toHaveLength(300);
    expect(summary?.endsWith("…")).toBe(true);
  });
});

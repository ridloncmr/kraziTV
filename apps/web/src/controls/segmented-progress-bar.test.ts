// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SegmentedProgressBar } from "./segmented-progress-bar.js";

afterEach(cleanup);

/** The bar's single fill element, whose blocks the stylesheet draws. */
function fillOf(bar: HTMLElement): HTMLElement {
  return bar.querySelector<HTMLElement>(".segmented-progress-fill")!;
}

it("reports determinate progress through ARIA and hands the fill its fraction", () => {
  render(
    createElement(SegmentedProgressBar, {
      label: "Scan progress",
      progress: { value: 1_204, max: 3_880 },
    }),
  );

  const bar = screen.getByRole("progressbar", { name: "Scan progress" });
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("3880");
  expect(bar.getAttribute("aria-valuenow")).toBe("1204");
  expect(fillOf(bar).style.getPropertyValue("--progress")).toBe(
    String(1_204 / 3_880),
  );
});

it.each([
  { value: 5, max: 4, fraction: "1" },
  { value: -1, max: 4, fraction: "0" },
  { value: 0, max: 0, fraction: "0" },
])(
  "keeps the fill inside the track for $value of $max",
  ({ value, max, fraction }) => {
    render(
      createElement(SegmentedProgressBar, {
        label: "Scan progress",
        progress: { value, max },
      }),
    );

    const bar = screen.getByRole("progressbar");
    expect(fillOf(bar).style.getPropertyValue("--progress")).toBe(fraction);
  },
);

it("omits aria-valuenow and the fill fraction while indeterminate", () => {
  render(createElement(SegmentedProgressBar, { label: "Scan progress" }));

  const bar = screen.getByRole("progressbar", { name: "Scan progress" });
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect(bar.hasAttribute("aria-valuemax")).toBe(false);
  expect(fillOf(bar).style.getPropertyValue("--progress")).toBe("");
});

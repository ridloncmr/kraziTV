// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { applyStylesheet } from "../../testing/apply-stylesheet.js";
import { styleRules } from "../../testing/style-rules.js";
import { GreggFigure } from "./gregg-figure.js";
import { GreggHead } from "./gregg-head.js";

afterEach(cleanup);

/** Renders one drawing and returns its root `<svg>`. */
function draw(drawing: typeof GreggFigure): SVGSVGElement {
  const { container } = render(createElement(drawing, { className: "placed" }));
  const svg = container.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error("no svg drawn");
  return svg;
}

/** The keyframes rule with this name, from any applied stylesheet. */
function keyframesNamed(name: string): CSSKeyframesRule | undefined {
  for (const sheet of document.styleSheets)
    for (const rule of sheet.cssRules)
      if (rule instanceof CSSKeyframesRule && rule.name === name) return rule;
  return undefined;
}

it("draws the 48 px figure as a decorative SVG with one smoke wisp of its own", () => {
  const svg = draw(GreggFigure);
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("viewBox")).toBe("0 0 48 48");
  expect(svg.getAttribute("class")).toBe("placed");
  expect(svg.querySelectorAll(".gregg-smoke")).toHaveLength(1);
  // Drawn last, so the wisp rises over the glass and nothing covers it.
  expect(svg.lastElementChild?.classList.contains("gregg-smoke")).toBe(true);
  // The balloon names him in text; the drawing itself says nothing.
  expect(svg.textContent).toBe("");
});

it("draws the 16 px tray head as a decorative SVG without smoke", () => {
  const svg = draw(GreggHead);
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
  expect(svg.getAttribute("class")).toBe("placed");
  expect(svg.querySelector(".gregg-smoke")).toBeNull();
  expect(svg.textContent).toBe("");
});

it("drifts the smoke with opacity and transform only, and holds it still under reduced motion", () => {
  applyStylesheet("tray-reminders/tray-reminders.css");
  const smoke = draw(GreggFigure).querySelector(".gregg-smoke")!;
  const smokeRules = styleRules().filter(({ rule }) =>
    smoke.matches(rule.selectorText),
  );

  // Drifts whatever the owner's motion setting, by a named keyframes rule.
  const drifting = smokeRules.filter(
    ({ rule, media }) => media === null && rule.style.animation !== "",
  );
  expect(drifting).toHaveLength(1);
  const name = drifting[0].rule.style.animation.split(/\s+/)[0];
  const keyframes = keyframesNamed(name);
  expect(keyframes).toBeDefined();
  const animated = new Set<string>();
  for (const frame of keyframes!.cssRules) {
    if (!(frame instanceof CSSKeyframeRule)) continue;
    for (const property of frame.style) animated.add(property);
  }
  expect([...animated].sort()).toEqual(["opacity", "transform"]);

  // Reduced motion stops the drift and nothing else.
  const still = smokeRules.filter(
    ({ media }) => media === "(prefers-reduced-motion: reduce)",
  );
  expect(still).toHaveLength(1);
  expect([...still[0].rule.style]).toEqual(["animation"]);
  expect(still[0].rule.style.animation).toBe("none");
});

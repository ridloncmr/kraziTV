// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { applyStylesheet } from "../../testing/apply-stylesheet.js";
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

/**
 * Every style rule the applied stylesheets hold, each with the media
 * condition it sits under, so a test can tell a rule that always applies
 * from one that applies only under reduced motion.
 */
function styleRules(): { rule: CSSStyleRule; media: string | null }[] {
  const rules: { rule: CSSStyleRule; media: string | null }[] = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule) rules.push({ rule, media: null });
      if (rule instanceof CSSMediaRule)
        for (const inner of rule.cssRules)
          if (inner instanceof CSSStyleRule)
            rules.push({ rule: inner, media: rule.media.mediaText });
    }
  }
  return rules;
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

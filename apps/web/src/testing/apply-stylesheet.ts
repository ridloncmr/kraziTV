import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * Applies one of the app's real stylesheets, named by its path under `src/`,
 * to the jsdom document for the current test, so the test reads what a rule
 * decides, such as a computed style that never wraps or the rule itself
 * through `document.styleSheets`, rather than only the class that names it.
 * jsdom does no layout, so widths and scroll sizes stay unknowable; the
 * stylesheet comes off when the test finishes.
 */
export function applyStylesheet(srcPath: string): void {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    join(import.meta.dirname, "..", srcPath),
    "utf8",
  );
  document.head.append(style);
  onTestFinished(() => style.remove());
}

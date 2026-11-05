import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * Applies the app's real `controls.css` to the jsdom document for the
 * current test, so the test reads the computed style a rule decides, such
 * as a column that never wraps, rather than only the class that names it.
 * jsdom does no layout, so widths and scroll sizes stay unknowable; the
 * stylesheet comes off when the test finishes.
 */
export function applyControlsStylesheet(): void {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    join(import.meta.dirname, "../controls/controls.css"),
    "utf8",
  );
  document.head.append(style);
  onTestFinished(() => style.remove());
}

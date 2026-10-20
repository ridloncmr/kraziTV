// Screenshots the live kraziTV desktop, optionally after opening one desktop
// program, so an agent can see the running app without a human at the screen.
//
// Usage:
//   npm run live:screenshot
//   npm run live:screenshot -- --program "My Channels" --out data/live-app/channels.png

import { join } from "node:path";
import { parseArgs } from "node:util";
import { openLiveApp } from "./live-session.mjs";

const { values } = parseArgs({
  options: {
    program: { type: "string" },
    out: {
      type: "string",
      default: join("data", "live-app", "screenshot.png"),
    },
    width: { type: "string", default: "1440" },
    height: { type: "string", default: "900" },
  },
});

const { browser, page } = await openLiveApp({
  width: Number(values.width),
  height: Number(values.height),
});
try {
  if (values.program) {
    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name: values.program, exact: true })
      .click();
    await page
      .getByRole("region", { name: values.program, exact: true })
      .waitFor();
    // Let the program's first reads settle before capturing.
    await page.waitForLoadState("networkidle");
  }
  await page.screenshot({ path: values.out });
  console.log(`Saved ${values.out}`);
} finally {
  await browser.close();
}

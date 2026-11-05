// Refreshes the user wiki's screenshots from the demo kraziTV, so
// `wiki/images/` keeps up with the web app without anyone cropping by hand
// and without showing the owner's own library. Every shot is read-only:
// dialogs are opened and cancelled, nothing is saved.
//
// Usage (the demo must be running and seeded; see scripts/demo-library):
//   node scripts/live-app/wiki-screenshots.mjs
//
// The names below are objects the demo seed creates. Change them with the
// seed; the script fails loudly when one is missing.
//
// The `tmdb-*.png` and `plex-tuner-*.png` images, and `plex-live-tv-dvr.png`,
// are not made here: they show TMDB's site and Plex's tuner setup, captured
// by hand with keys, contact details, and the owner's server and account
// names hidden, and Plex pointed at the demo. Retake them by hand if those
// screens change.

import { chromium } from "playwright";
import { hideMachineValues, openDemoApp } from "../demo-library/demo-app.mjs";
import { DEMO_URL } from "../demo-library/library.mjs";
import { desktopActions } from "./desktop-actions.mjs";

const out = new URL("../../wiki/images/", import.meta.url).pathname;
const names = {
  channelWithWheel: "Classic TV",
  wheel: "The Beverly Hillbillies + The Andy Griffith Show",
  channelWithRules: "Movie Night",
  randomShow: "Comedy Classics",
  channelWithMarathons: "Classic TV",
  rule: "Halloween",
  mediaItem: "The Lone Ranger – S01E01",
  collection: "The Dick Van Dyke Show",
  manualCollection: "Comedy Classics",
  guideChannel: "Classic TV",
  monitorChannel: "2 · Classic TV",
};

/** The logon screen needs a browser with no session, so it gets its own. */
async function shootLogon() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.goto(DEMO_URL);
  const tile = page.getByRole("button", { name: /./ }).first();
  await tile.waitFor({ timeout: 15_000 });
  await tile.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}logon.png` });
  await browser.close();
}

await shootLogon();
const { browser, page } = await openDemoApp({ width: 1600, height: 1000 });
const { settle, win, openProgram, closeWindow, maximize, menuItem, tab } =
  desktopActions(page);
/**
 * Captures one wiki image. `clicks` are the controls the wiki step tells the
 * reader to use; each gets the red outline the hand-made TMDB and Plex
 * images use, drawn here so a refresh keeps it.
 */
const shot = async (file, locator = page, clicks = []) => {
  await page.waitForTimeout(400);
  await hideMachineValues(page);
  await outline(clicks);
  await locator.screenshot({ path: `${out}${file}.png` });
  await page.evaluate(() => {
    const { document } = globalThis;
    document.querySelectorAll("[data-wiki-outline]").forEach((e) => e.remove());
  });
};
/**
 * Draws a red ring around each control on top of the page. Fails when a
 * control is missing, so a renamed button never yields an image without
 * its outline.
 */
const outline = async (clicks) => {
  const boxes = [];
  for (const control of clicks) {
    const box = await control.boundingBox();
    if (!box) throw new Error(`Nothing to outline: ${control}`);
    boxes.push(box);
  }
  await page.evaluate((rings) => {
    const { document } = globalThis;
    for (const { x, y, width, height } of rings) {
      const ring = document.createElement("div");
      ring.dataset.wikiOutline = "";
      Object.assign(ring.style, {
        position: "fixed",
        left: `${x - 6}px`,
        top: `${y - 6}px`,
        width: `${width + 12}px`,
        height: `${height + 12}px`,
        border: "4px solid #dc2626",
        borderRadius: "6px",
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.append(ring);
    }
  }, boxes);
};
const lastDialog = () => page.getByRole("dialog").last();
const cancelDialog = () =>
  lastDialog().getByRole("button", { name: "Cancel", exact: true }).click();

try {
  await page.getByRole("button", { name: "start", exact: true }).click();
  await page.waitForTimeout(500);
  await shot("desktop-start");
  await page.keyboard.press("Escape");

  await openProgram("Media Library");
  await maximize("Media Library");
  await shot("media-library", win("Media Library"), [
    page.getByRole("button", { name: "Add media root…" }),
  ]);
  await page
    .getByRole("button", { name: `Details for ${names.mediaItem}` })
    .click();
  await settle();
  await shot(
    "media-details",
    page.getByRole("dialog", { name: "Media details" }),
  );
  await page.getByRole("button", { name: "Correct details…" }).click();
  await settle();
  await shot("correct-details", lastDialog());
  await cancelDialog();
  await page.keyboard.press("Escape");
  await closeWindow("Media Library");

  await openProgram("Collections");
  await maximize("Collections");
  await tab(page, "Automatic");
  await shot("collections", win("Collections"), [
    page.getByRole("button", { name: "Discover collections…" }),
    page.getByRole("button", { name: "New automatic collection…" }),
  ]);
  await page.getByRole("button", { name: "Discover collections…" }).click();
  await settle();
  await shot(
    "discover-collections",
    page.getByRole("dialog", { name: "Discover collections" }),
  );
  await lastDialog()
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "New automatic collection…" }).click();
  await settle();
  await lastDialog().getByRole("radio", { name: "Tag" }).check();
  await lastDialog().getByRole("combobox").first().selectOption({ index: 1 });
  await settle();
  await shot("new-automatic-collection", lastDialog());
  await cancelDialog();
  await page
    .getByRole("button", { name: `Open ${names.collection}` })
    .first()
    .click();
  await settle();
  await shot("collection-properties", win(`${names.collection} Properties`));
  await closeWindow(`${names.collection} Properties`);
  await tab(page, "Manual");
  await page
    .getByRole("button", { name: `Open ${names.manualCollection}` })
    .first()
    .click();
  await settle();
  await shot("collection-editor", win(`${names.manualCollection} Properties`));
  await closeWindow(`${names.manualCollection} Properties`);
  await closeWindow("Collections");

  await openProgram("My Channels");
  await page
    .getByText("Checking…")
    .first()
    .waitFor({ state: "detached", timeout: 20_000 })
    .catch(() => {});
  await shot("my-channels", win("My Channels"), [
    page.getByRole("button", { name: "New channel…" }),
  ]);
  await maximize("My Channels");

  await menuItem(`Actions for ${names.channelWithWheel}`, "Properties");
  const lineup = win(`${names.channelWithWheel} Properties`);
  await tab(lineup, "Lineup");
  await shot("channel-lineup", lineup, [
    lineup.getByRole("button", { name: "Add shows…" }),
  ]);
  await menuItem(`Actions for ${names.wheel}`, "Properties");
  await shot("show-properties-general", lineup);
  await tab(lastDialog(), "Contents");
  await shot("show-properties-contents", lineup);
  await cancelDialog();
  await lineup.getByRole("button", { name: "Add shows…" }).click();
  await settle();
  const picks = lastDialog()
    .getByRole("list", { name: "Search results" })
    .getByRole("checkbox");
  await picks.nth(0).check();
  await picks.nth(1).check();
  const next = lastDialog().getByRole("button", { name: /^Next/ });
  await shot("add-shows", lineup, [picks.nth(0), picks.nth(1), next]);
  await next.click();
  await settle();
  await page.waitForTimeout(1500);
  await shot("add-shows-settings", lineup, [
    lastDialog().getByRole("group").first(),
    lastDialog().getByRole("button", { name: /^Add/ }),
  ]);
  await cancelDialog();
  await tab(lineup, "Preview");
  await shot("channel-preview", lineup);
  await closeWindow(`${names.channelWithWheel} Properties`);

  await menuItem(`Actions for ${names.channelWithMarathons}`, "Properties");
  const marathons = win(`${names.channelWithMarathons} Properties`);
  await tab(marathons, "Lineup");
  await shot("channel-marathons", marathons);
  await closeWindow(`${names.channelWithMarathons} Properties`);

  await menuItem(`Actions for ${names.channelWithRules}`, "Properties");
  const rules = win(`${names.channelWithRules} Properties`);
  // Up Next comes from a random show, so the shot shows Reshuffle….
  await tab(rules, "Lineup");
  await menuItem(`Actions for ${names.randomShow}`, "Properties");
  await tab(lastDialog(), "Up Next");
  await shot("show-properties-up-next", rules);
  await cancelDialog();
  await tab(rules, "Rules");
  await shot("channel-rules", rules);
  await menuItem(`Actions for ${names.rule}`, "Properties");
  await shot("rule-general", rules);
  await tab(lastDialog(), "When");
  await shot("rule-when", rules);
  await tab(lastDialog(), "What plays");
  await shot("rule-what-plays", rules);
  await cancelDialog();
  await tab(rules, "Specials");
  await rules.getByRole("button", { name: "New special…" }).click();
  await settle();
  const special = page.getByRole("dialog", { name: "New special" });
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(20, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  await special
    .getByLabel("Starts", { exact: true })
    .fill(
      `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T20:00`,
    );
  await special
    .getByRole("radio", { name: "A collection, from the start" })
    .check();
  await special
    .getByRole("combobox", { name: "Collection", exact: true })
    .selectOption({ index: 1 });
  await special
    .getByRole("combobox", { name: "Play order", exact: true })
    .selectOption({ label: "Release order" });
  await special.getByRole("button", { name: "Preview", exact: true }).click();
  await settle();
  await page.waitForTimeout(1000);
  await shot("special-preview", rules);
  await cancelDialog();
  await closeWindow(`${names.channelWithRules} Properties`);
  await closeWindow("My Channels");

  await openProgram("Program Guide");
  await maximize("Program Guide");
  await shot("program-guide", win("Program Guide"));
  // The airing program, so its card offers Watch.
  await page
    .getByRole("list", { name: `Programs on ${names.guideChannel}` })
    .locator("li.airing button")
    .click();
  await settle();
  await shot("program-card", win("Program Guide"));
  await page.keyboard.press("Escape");
  await closeWindow("Program Guide");

  await openProgram("TV");
  // Let the picture start before capturing it.
  await page.waitForTimeout(9000);
  await shot("tv", win("TV"));
  await closeWindow("TV");

  await openProgram("Plex Setup");
  await shot("plex-setup", win("Plex Setup"), [
    page.getByRole("button", { name: "Copy Tuner base URL" }),
    page.getByRole("button", { name: "Copy XMLTV guide URL" }),
  ]);
  await closeWindow("Plex Setup");

  await openProgram("Live Monitor");
  await page
    .getByRole("combobox", { name: "Channel" })
    .selectOption({ label: names.monitorChannel });
  await settle();
  await shot("live-monitor", win("Live Monitor"));
  await closeWindow("Live Monitor");

  await openProgram("Account Settings");
  await shot("account-settings", win("Account Settings"));
  await page.getByRole("button", { name: "Set up TMDB" }).click();
  await settle();
  await shot("set-up-tmdb", win("Account Settings"), [
    page.getByLabel("API Read Access Token"),
    page.getByRole("button", { name: "Save", exact: true }),
  ]);
  await closeWindow("Account Settings");
  console.log(`Saved the wiki screenshots to ${out}`);
} finally {
  await browser.close();
}

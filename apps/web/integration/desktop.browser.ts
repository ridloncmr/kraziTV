import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  startTestServer,
  cleanUpTestEnvironment,
  createTemporaryDirectory,
} from "../../server/src/testing/test-environment.js";
import {
  rootFixture,
  titledItemFixture,
} from "../../server/src/testing/catalog-fixtures.js";
import { ControlledProber } from "../../server/src/testing/controlled-prober.js";
import { IdleMetadataRefresh } from "../../server/src/testing/idle-metadata-refresh.js";
import { PROBE_RESULT } from "../../server/src/testing/discovery-fixtures.js";
import { recordingLog } from "../../server/src/testing/recording-log.js";
import { withoutTmdbKey } from "../../server/src/testing/scan-metadata.js";
import { startScheduleScenarioServer } from "../../server/src/testing/schedule-server.js";
import { injectBrowserApi } from "../src/testing/injected-api.js";
import { CatalogScanner } from "../../server/src/catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../../server/src/catalog-scan/writer/catalog-scan-writer.js";
import {
  createBarrier,
  type TestBarrier,
} from "../../server/src/testing/test-barrier.js";

let prober: ControlledProber | undefined;
let commit: TestBarrier | undefined;
test.afterEach(async () => {
  commit?.release();
  prober?.resolveAll(PROBE_RESULT);
  await cleanUpTestEnvironment();
});

/**
 * Starts a real server whose scans probe through a `ControlledProber`, so
 * the test settles each probe. With `holdCommit`, a completed commit waits
 * in `committing` until the test releases `commit`.
 */
async function startScanServer(options: { holdCommit?: boolean } = {}) {
  const controlled = new ControlledProber();
  prober = controlled;
  const held = options.holdCommit ? (commit = createBarrier()) : undefined;
  const started = await startTestServer({
    plex: { publicBaseUrl: "http://northwoods.lan:3000" },
    overrides: (db, { mediaRoots, schedules, catalogRemovals }) => ({
      scanner: new CatalogScanner({
        roots: mediaRoots,
        prober: controlled,
        writer: new CatalogScanWriter(db),
        schedules: {
          ensureAllEnabled: async (log) => {
            await held?.wait();
            await schedules.ensureAllEnabled(log);
          },
        },
        removals: catalogRemovals,
        metadataRefresh: new IdleMetadataRefresh(),
        metadata: withoutTmdbKey(),
        log: recordingLog(),
      }),
    }),
  });
  return { ...started, prober: controlled };
}

/** Adds `directory` as a media root in the Media Library and starts its scan. */
async function scanNewRoot(page: Page, directory: string) {
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  const media = page.getByRole("region", {
    name: "Media Library",
    exact: true,
  });
  await media.getByRole("button", { name: "Add a media root…" }).click();
  const addRoot = media.getByRole("dialog", { name: "Add media root" });
  await addRoot.getByLabel("Absolute server path").fill(directory);
  await addRoot.getByRole("button", { name: "Add root", exact: true }).click();
  await expect(addRoot).toBeHidden();
  await media.getByRole("button", { name: "Scan", exact: true }).click();
  const scanning = media.getByRole("dialog", { name: "Scanning media root" });
  await expect(scanning).toBeVisible();
  return { media, scanning };
}

test("lays each airing choice's radio beside its label", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Channel 69 airs "Item 1" now, so removing it offers the airing choice.
  const { server } = await startScheduleScenarioServer();
  await injectBrowserApi(page, server);
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  const media = page.getByRole("region", {
    name: "Media Library",
    exact: true,
  });
  await media.getByRole("checkbox", { name: "Select Item 1" }).check();
  await media
    .getByRole("group", { name: "Selected media" })
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  const dialog = media.getByRole("dialog", { name: "Delete media" });

  for (const label of [
    "Let it finish",
    "Stop it now and rebuild the schedule",
  ]) {
    const radio = await dialog
      .getByRole("radio", { name: new RegExp(label) })
      .boundingBox();
    const text = await dialog.getByText(label, { exact: true }).boundingBox();
    // Beside, not above: left of the label and level with its first line.
    expect(radio!.x + radio!.width).toBeLessThanOrEqual(text!.x);
    expect(radio!.y).toBeLessThan(text!.y + text!.height);
    expect(radio!.y + radio!.height).toBeGreaterThan(text!.y);
  }
});

test("removes selected media through the Media Library against real routes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server, db } = await startTestServer({
    seed: async (db) => {
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([
          titledItemFixture("Northwoods"),
          titledItemFixture("Southwoods"),
        ])
        .execute();
    },
  });
  await injectBrowserApi(page, server);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  const media = page.getByRole("region", {
    name: "Media Library",
    exact: true,
  });

  const remove = media
    .getByRole("group", { name: "Selected media" })
    .getByRole("button", { name: "Delete…", exact: true });
  await expect(remove).toBeDisabled();
  await media.getByRole("checkbox", { name: "Select Northwoods" }).check();
  await remove.click();
  const dialog = media.getByRole("dialog", { name: "Delete media" });
  await expect(
    dialog.getByText("1 selected media item will be deleted from the catalog."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(media.getByText("Deleted 1 media item.")).toBeVisible();
  await expect(
    media.getByRole("checkbox", { name: "Select Northwoods" }),
  ).toHaveCount(0);
  await expect(
    media.getByRole("checkbox", { name: "Select Southwoods" }),
  ).not.toBeChecked();
  await expect(remove).toBeDisabled();
  // Nothing airs it, so the removal purged the row in the same commit.
  await expect(
    db.selectFrom("media_items").select("title").execute(),
  ).resolves.toEqual([{ title: "Southwoods" }]);
  expect(errors).toEqual([]);
});

test("picks a media root by browsing real server folders at narrow width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { server, db } = await startTestServer();
  await injectBrowserApi(page, server);
  const directory = await createTemporaryDirectory();
  await mkdir(join(directory, "Shows"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  const media = page.getByRole("region", {
    name: "Media Library",
    exact: true,
  });
  await media.getByRole("button", { name: "Add a media root…" }).click();
  const addRoot = media.getByRole("dialog", { name: "Add media root" });
  await addRoot.getByLabel("Absolute server path").fill(directory);

  await addRoot.getByRole("button", { name: "Browse…" }).click();
  const browser = addRoot.getByRole("group", { name: "Server folders" });
  await browser.getByRole("button", { name: "Shows", exact: true }).click();
  await expect(browser.getByText("No folders here.")).toBeVisible();
  await expect(addRoot.getByLabel("Absolute server path")).toHaveValue(
    join(directory, "Shows"),
  );
  // The whole dialog, Add root included, stays inside the narrow window.
  await expect(
    addRoot.getByRole("button", { name: "Add root", exact: true }),
  ).toBeInViewport();
  await addRoot.getByRole("button", { name: "Add root", exact: true }).click();

  await expect(addRoot).toBeHidden();
  await expect(
    db.selectFrom("media_roots").select("path").execute(),
  ).resolves.toEqual([{ path: join(directory, "Shows") }]);
  expect(errors).toEqual([]);
});

test("operates title-bar controls on an inactive window with one click", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer();
  await injectBrowserApi(page, server);
  await page.goto("/");
  const shortcuts = page.getByLabel("Desktop programs");
  /** Opens a program and moves it to the bottom-right so earlier windows' controls stay uncovered. */
  async function openAside(name: string) {
    await shortcuts.getByRole("button", { name, exact: true }).click();
    const title = page.getByLabel(new RegExp(`${name} window`));
    for (let step = 0; step < 20; step++) {
      await title.press("ArrowDown");
      await title.press("ArrowRight");
    }
    return page.getByRole("region", { name, exact: true });
  }
  await shortcuts
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  const media = page.getByRole("region", { name: "Media Library" });
  const collections = await openAside("Collections");

  await expect(media).toHaveClass(/inactive/);
  await media.getByRole("button", { name: "Maximize Media Library" }).click();
  await expect(media).toHaveClass(/maximized/);
  await media.getByRole("button", { name: "Restore Media Library" }).click();

  await expect(collections).toHaveClass(/inactive/);
  await collections.getByRole("button", { name: "Close Collections" }).click();
  await expect(collections).toHaveCount(0);

  await openAside("Program Guide");
  await expect(media).toHaveClass(/inactive/);
  await media.getByRole("button", { name: "Minimize Media Library" }).click();
  await expect(media).toBeHidden();
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`operates the real catalog-to-Plex loop at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { server, prober: controlled } = await startScanServer();
    await injectBrowserApi(page, server);
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, "Northwoods.mp4"),
      "test media; probing is controlled",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "start", exact: true }),
    ).toBeVisible();

    const { media, scanning } = await scanNewRoot(page, directory);
    await controlled.waitForStarted(1);
    await expect(scanning.getByRole("status")).toHaveText(
      "Probing media files…",
    );
    const bar = scanning.getByRole("progressbar");
    await expect(bar).toHaveAttribute("aria-valuemax", "1");
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await expect(scanning.getByText("0 of 1 files")).toBeVisible();
    const close = scanning.getByRole("button", {
      name: "Close Scanning media root",
    });
    await expect(close).toBeDisabled();
    const busyClose = await closeButtonLook(close);
    await expect(media.locator(".window-content")).toHaveAttribute("inert", "");
    await expect(
      page
        .getByLabel("Desktop programs")
        .getByRole("button", { name: "Collections", exact: true }),
    ).toBeEnabled();
    controlled.resolveAll({ ...PROBE_RESULT, durationMs: 1_200_000 });
    await expect(scanning.getByRole("status")).toHaveText("Scan completed.");
    await expect(close).toBeEnabled();
    // A disabled close button must not look like the one that works.
    expect(await closeButtonLook(close)).not.toEqual(busyClose);
    await expect(
      scanning.locator(".facts dt", { hasText: "Discovered" }).locator("+ dd"),
    ).toHaveText("1");
    await scanning.getByRole("button", { name: "OK", exact: true }).click();
    await expect(scanning).toBeHidden();
    await expect(
      media.getByRole("cell", { name: /^Northwoods / }),
    ).toBeVisible();
    await media.getByRole("button", { name: "Minimize Media Library" }).click();

    await page.getByRole("button", { name: "start", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Start programs" })
      .getByRole("button", { name: /Collections/ })
      .click();
    const collections = page.getByRole("region", {
      name: "Collections",
      exact: true,
    });
    await collections
      .getByRole("button", { name: "Create a collection…" })
      .click();
    const newCollection = collections.getByRole("dialog", {
      name: "New collection",
    });
    await newCollection
      .getByLabel("Collection name")
      .fill("Northwoods collection");
    await newCollection
      .getByRole("button", { name: "Create collection" })
      .click();
    await expect(newCollection).toBeHidden();
    await collections
      .getByRole("checkbox", { name: /^Select Northwoods/ })
      .check();
    await collections
      .getByRole("button", { name: "Add selected (1)", exact: true })
      .click();
    await collections.getByRole("button", { name: "Save changes" }).click();
    await expect(
      collections.getByText(/Schedulable · 1 eligible/),
    ).toBeVisible();
    await collections
      .getByRole("button", { name: "Close Collections" })
      .click();

    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name: "My Channels", exact: true })
      .click();
    const channels = page.getByRole("region", {
      name: "My Channels",
      exact: true,
    });
    await channels.getByRole("button", { name: "New channel…" }).click();
    const newChannel = channels.getByRole("dialog", { name: "New channel" });
    await newChannel.getByLabel("Channel number", { exact: true }).fill("69");
    await newChannel
      .getByLabel("Channel name", { exact: true })
      .fill("Northwoods TV");
    await newChannel
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await expect(newChannel).toBeHidden();
    await channels
      .getByLabel("Programming source")
      .selectOption({ label: "Northwoods collection" });
    await channels.getByRole("button", { name: "Save programming" }).click();
    await expect(channels.getByText(/Backend schedule:/)).toBeVisible();
    await channels
      .getByRole("button", { name: "Maximize My Channels" })
      .click();
    await expect(channels).toHaveClass(/maximized/);
    await channels.getByRole("button", { name: "Restore My Channels" }).click();
    await channels.getByRole("button", { name: "Close My Channels" }).click();

    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name: "Program Guide", exact: true })
      .click();
    const guide = page.getByRole("region", {
      name: "Program Guide",
      exact: true,
    });
    await guide
      .getByRole("combobox", { name: "Channel", exact: true })
      .selectOption({ label: "69 · Northwoods TV" });
    await expect(guide.getByText("On air", { exact: true })).toBeVisible();
    await expect(
      guide.getByText("Playback offset", { exact: true }),
    ).toBeVisible();
    if (viewport.width > 620) {
      const title = guide.getByLabel(/Program Guide window/);
      const before = await guide.boundingBox();
      await title.hover();
      await page.mouse.down();
      await page.mouse.move((before?.x ?? 0) + 200, (before?.y ?? 0) + 90);
      await page.mouse.up();
      const after = await guide.boundingBox();
      expect(after?.x).not.toBe(before?.x);
    }
    await page.screenshot({
      path: `../../data/web-guide-${viewport.width}.png`,
    });
    await guide.getByRole("button", { name: "Close Program Guide" }).click();

    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name: "Plex Setup", exact: true })
      .click();
    const plex = page.getByRole("region", { name: "Plex Setup", exact: true });
    await expect(
      plex.getByLabel("Tuner base URL", { exact: true }),
    ).toHaveValue("http://northwoods.lan:3000");
    await expect(
      plex.getByLabel("XMLTV guide URL", { exact: true }),
    ).toHaveValue("http://northwoods.lan:3000/plex/xmltv.xml");
    await plex.getByRole("button", { name: "Close Plex Setup" }).click();
    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name: "Live Monitor", exact: true })
      .click();
    const monitor = page.getByRole("region", {
      name: "Live Monitor",
      exact: true,
    });
    await expect(
      monitor.getByText("API connected", { exact: true }),
    ).toBeVisible();
    await monitor
      .getByRole("combobox", { name: "Channel", exact: true })
      .selectOption({ label: "69 · Northwoods TV" });
    await expect(
      monitor.getByText("Playback offset", { exact: true }),
    ).toBeVisible();
    await monitor.getByRole("button", { name: "Close Live Monitor" }).click();
    await page.screenshot({
      path: `../../data/web-desktop-${viewport.width}.png`,
    });
    expect(errors).toEqual([]);
    const tray = await page.locator(".taskbar").boundingBox();
    expect(tray?.y).toBe(viewport.height - 32);
  });
}

/** The computed styles that tell a disabled title-bar button from an enabled one. */
function closeButtonLook(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundImage + style.backgroundColor,
      filter: style.filter,
      opacity: style.opacity,
    };
  });
}

/** The CSS animations running on an element; the stylesheet is the dialog's only motion. */
function runningAnimations(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getAnimations().length);
}

for (const pass of [
  { name: "wide", viewport: { width: 1280, height: 800 }, reduced: false },
  { name: "narrow", viewport: { width: 390, height: 844 }, reduced: false },
  {
    name: "reduced-motion",
    viewport: { width: 1280, height: 800 },
    reduced: true,
  },
]) {
  test(`draws the scan progress visuals in the ${pass.name} pass`, async ({
    page,
  }) => {
    await page.setViewportSize(pass.viewport);
    await page.emulateMedia({
      reducedMotion: pass.reduced ? "reduce" : "no-preference",
    });
    const { server, prober: controlled } = await startScanServer({
      holdCommit: true,
    });
    await injectBrowserApi(page, server);
    const directory = await createTemporaryDirectory();
    const files = ["Alpha.mp4", "Beta.mp4", "Gamma.mp4"];
    for (const file of files)
      await writeFile(
        join(directory, file),
        "test media; probing is controlled",
      );
    await page.goto("/");
    const { scanning } = await scanNewRoot(page, directory);
    const bar = scanning.getByRole("progressbar");
    const fill = bar.locator(".segmented-progress-fill");
    const paper = scanning.locator(".scan-paper-x");

    await controlled.waitForStarted(files.length);
    controlled.started[0].resolve(PROBE_RESULT);
    await expect(scanning.getByText("1 of 3 files")).toBeVisible();
    await expect(bar).toHaveAttribute("aria-valuenow", "1");
    // The fill snaps down to whole blocks of the track's content width.
    const { filled, track } = await fill.evaluate((element) => ({
      filled: element.getBoundingClientRect().width,
      track: element.parentElement?.clientWidth ?? 0,
    }));
    expect(filled).toBe(Math.floor((track - 4) / 3 / 12) * 12);
    const box = await scanning.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      pass.viewport.width,
    );
    expect(
      await scanning.evaluate(
        (dialog) => dialog.scrollWidth <= dialog.clientWidth,
      ),
    ).toBe(true);
    expect(await runningAnimations(paper)).toBe(pass.reduced ? 0 : 1);
    if (pass.name === "wide")
      await scanning.screenshot({ path: "../../data/web-scan-probing.png" });

    controlled.resolveAll(PROBE_RESULT);
    await expect(scanning.getByRole("status")).toHaveText(
      "Saving to the catalog…",
    );
    await expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(await runningAnimations(paper)).toBe(0);
    expect(await runningAnimations(fill)).toBe(pass.reduced ? 0 : 1);
    expect((await fill.boundingBox())?.width).toBeGreaterThan(0);
    if (pass.name === "wide")
      await scanning.screenshot({ path: "../../data/web-scan-committing.png" });

    commit?.release();
    await expect(scanning.getByRole("status")).toHaveText("Scan completed.");
    await expect(scanning.locator(".scan-animation")).toBeVisible();
    expect(await runningAnimations(paper)).toBe(0);
    await scanning.getByRole("button", { name: "OK", exact: true }).click();
    await expect(scanning).toBeHidden();
  });
}

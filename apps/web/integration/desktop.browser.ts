import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { createChannel, send } from "../../server/src/testing/api-requests.js";
import { ControlledProber } from "../../server/src/testing/controlled-prober.js";
import { IdleMetadataRefresh } from "../../server/src/testing/idle-metadata-refresh.js";
import { PROBE_RESULT } from "../../server/src/testing/discovery-fixtures.js";
import { recordingLog } from "../../server/src/testing/recording-log.js";
import { withoutTmdbKey } from "../../server/src/testing/scan-metadata.js";
import { startScheduleScenarioServer } from "../../server/src/testing/schedule-server.js";
import {
  detachBrowserApi,
  injectBrowserApi,
} from "../src/testing/injected-api.js";
import { CatalogScanner } from "../../server/src/catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../../server/src/catalog-scan/writer/catalog-scan-writer.js";
import {
  createBarrier,
  type TestBarrier,
} from "../../server/src/testing/test-barrier.js";

let prober: ControlledProber | undefined;
let commit: TestBarrier | undefined;
test.afterEach(async ({ page }) => {
  await detachBrowserApi(page);
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
    overrides: (
      db,
      { mediaRoots, schedules, catalogRemovals, collectionMaintenance },
    ) => ({
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
        collections: collectionMaintenance,
        metadata: withoutTmdbKey(),
        log: recordingLog(),
      }),
    }),
  });
  return { ...started, prober: controlled };
}

/** Adds `directory` as a media root in the Media Library and accepts the scan it offers. */
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
  await addRoot.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(addRoot).toBeHidden();
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
  // The scan offer stays inside the window too; declining keeps the root.
  await expect(
    addRoot.getByRole("button", { name: "Not now", exact: true }),
  ).toBeInViewport();
  await addRoot.getByRole("button", { name: "Not now", exact: true }).click();

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

test("keeps My Channels' buttons in view over nine channels and ends a long caption in an ellipsis", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer();
  const longName =
    "The Northwoods Late Night Classic Movie and Saturday Cartoon Network";
  // The long name sorts first, so its row is in view without scrolling.
  for (let number = 1; number <= 9; number++)
    await createChannel(server, {
      number: String(number),
      name: number === 1 ? longName : `Channel ${number}`,
    });
  await injectBrowserApi(page, server);
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "My Channels", exact: true })
    .click();
  const channels = page.getByRole("region", {
    name: "My Channels",
    exact: true,
  });
  await expect(channels.getByRole("row")).toHaveCount(10);
  // A shorter window, so nine rows overflow it.
  const title = page.getByLabel(/My Channels window/);
  for (let step = 0; step < 12; step++) await title.press("Shift+ArrowUp");

  const content = channels.locator(".window-content");
  expect(
    await content.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  const bar = channels.locator(".sticky-list-actions");
  const shown = await content.boundingBox();
  const stuck = await bar.boundingBox();
  expect(stuck!.y + stuck!.height).toBeLessThanOrEqual(
    shown!.y + shown!.height + 1,
  );
  await page.screenshot({ path: "../../data/web-my-channels-nine.png" });

  await channels.getByRole("button", { name: longName, exact: true }).click();
  await channels
    .getByRole("button", { name: "Properties", exact: true })
    .click();
  const properties = page.getByRole("region", {
    name: `${longName} Properties`,
    exact: true,
  });
  // Narrowed to its minimum width, so the caption overflows whichever
  // fallback font the machine has.
  const propertiesTitle = properties.getByLabel(/ Properties window\./);
  for (let step = 0; step < 16; step++)
    await propertiesTitle.press("Shift+ArrowLeft");
  const caption = properties.locator(".window-title");
  expect(
    await caption.evaluate((element) => ({
      overflows: element.scrollWidth > element.clientWidth,
      textOverflow: getComputedStyle(element).textOverflow,
    })),
  ).toEqual({ overflows: true, textOverflow: "ellipsis" });
  // The caption gives way; the close button stays inside the window.
  const frame = await properties.boundingBox();
  const close = await properties
    .getByRole("button", { name: `Close ${longName} Properties` })
    .boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  await properties.locator(".title-bar").screenshot({
    path: "../../data/web-long-caption.png",
  });
});

// jsdom never turns Enter in a field into a click on the form's first
// submit button, so only a real browser can show Enter pressing OK.
test("presses OK with Enter in a property sheet, closing it unchanged or saving its change", async ({
  page,
}) => {
  const { server } = await startTestServer();
  await createChannel(server, { number: "69", name: "Northwoods TV" });
  await injectBrowserApi(page, server);
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "My Channels", exact: true })
    .click();
  const channels = page.getByRole("region", {
    name: "My Channels",
    exact: true,
  });
  const anyProperties = page.getByRole("region", { name: / Properties$/ });
  // Opens the channel's General tab and returns its Name field.
  const openGeneral = async (channelName: string) => {
    await channels
      .getByRole("button", { name: channelName, exact: true })
      .click();
    await channels
      .getByRole("button", { name: "Properties", exact: true })
      .click();
    const properties = page.getByRole("region", {
      name: `${channelName} Properties`,
      exact: true,
    });
    // A channel with no shows moves to Lineup once its lineup reads; wait
    // for that, or the General click can land first and be undone.
    await expect(
      properties.getByRole("tab", { name: "Lineup" }),
    ).toHaveAttribute("aria-selected", "true");
    await properties.getByRole("tab", { name: "General" }).click();
    return properties.getByLabel("Name", { exact: true });
  };

  // Unchanged, Enter closes the sheet at once, through OK's no-change path.
  await (await openGeneral("Northwoods TV")).press("Enter");
  await expect(anyProperties).toHaveCount(0);

  // Changed, Enter saves it and closes, as OK does.
  const name = await openGeneral("Northwoods TV");
  await name.fill("Lakeside TV");
  await name.press("Enter");
  await expect(anyProperties).toHaveCount(0);
  const listed = await send(server, "GET", "/channels");
  expect(listed.body).toMatchObject([{ number: "69", name: "Lakeside TV" }]);
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
      scanning.locator(".facts dt", { hasText: "Files found" }).locator("+ dd"),
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
    await collections.getByRole("button", { name: "New collection…" }).click();
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
    // The new collection opens in its own properties window.
    const collection = page.getByRole("region", {
      name: "Northwoods collection Properties",
      exact: true,
    });
    await collection
      .getByRole("checkbox", { name: /^Select Northwoods/ })
      .check();
    await collection
      .getByRole("button", { name: "Add selected (1)", exact: true })
      .click();
    await collection.getByRole("button", { name: "Save changes" }).click();
    await expect(
      collection.getByText("1 of 1 can air", { exact: true }),
    ).toBeVisible();
    await collection
      .getByRole("button", { name: "Close Northwoods collection Properties" })
      .click();
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
    // The new channel opens in its own properties window.
    const properties = page.getByRole("region", {
      name: "Northwoods TV Properties",
      exact: true,
    });
    await properties.getByRole("tab", { name: "Lineup" }).click();
    await properties.getByRole("button", { name: "Add shows…" }).click();
    const addShows = properties.getByRole("dialog", { name: "Add shows" });
    await addShows
      .getByRole("checkbox", { name: /^Northwoods collection/ })
      .check();
    await addShows.getByRole("button", { name: "Next (1)" }).click();
    // One unmatched file suggests no per sitting, so the owner chooses.
    await addShows
      .getByLabel("Plays at a time")
      .selectOption({ label: "1 program" });
    await addShows.getByRole("button", { name: "Add (1)" }).click();
    await expect(addShows).toBeHidden();
    // The server already generated the schedule, and nothing was airing on
    // the new channel, so the first show asks no rebuild question.
    await expect(
      properties
        .getByRole("table", { name: "Shows" })
        .getByRole("button", { name: "Northwoods collection", exact: true }),
    ).toBeVisible();
    await expect(properties.getByRole("dialog")).toHaveCount(0);
    await properties.getByRole("tab", { name: "Preview" }).click();
    await expect(
      properties.getByRole("list", { name: "Upcoming shows" }),
    ).toContainText("Northwoods collection");
    await properties
      .getByRole("button", { name: "Close Northwoods TV Properties" })
      .click();
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
    const programs = guide.getByRole("list", {
      name: "Programs on Northwoods TV",
    });
    await expect(
      programs.getByRole("listitem").filter({ hasText: "Northwoods" }).first(),
    ).toBeVisible();
    // The channel went on air when its lineup was saved, so a block is airing.
    await expect(programs.locator(".guide-block.airing")).toHaveCount(1);
    await expect(
      guide.getByRole("button", { name: "Now", exact: true }),
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
    // The first run ends watching the channel in TV. The browser job has no
    // FFmpeg, so the stream answers with the committed test pattern; this
    // route is registered after the API route, so it answers first.
    const pattern = await readFile(
      new URL("fixtures/test-pattern.mpegts", import.meta.url),
    );
    await page.route("http://127.0.0.1:3000/channels/*/stream", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "video/MP2T",
          "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
        },
        body: pattern,
      }),
    );
    await guide
      .getByRole("button", { name: "Watch 69 Northwoods TV on TV" })
      .click();
    const tv = page.getByRole("region", { name: "TV", exact: true });
    await expect
      .poll(() =>
        tv
          .getByLabel("69 Northwoods TV")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(1);
    await tv.getByRole("button", { name: "Close TV" }).click();
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
      monitor.getByText("kraziTV is running", { exact: true }),
    ).toBeVisible();
    await monitor
      .getByRole("combobox", { name: "Channel", exact: true })
      .selectOption({ label: "69 · Northwoods TV" });
    await expect(monitor.getByText("Position", { exact: true })).toBeVisible();
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

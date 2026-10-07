import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  startTestServer,
  cleanUpTestEnvironment,
  createTemporaryDirectory,
} from "../../server/src/testing/test-environment.js";
import { ControlledProber } from "../../server/src/testing/controlled-prober.js";
import { PROBE_RESULT } from "../../server/src/testing/discovery-fixtures.js";
import { injectBrowserApi } from "../src/testing/injected-api.js";
import { CatalogScanner } from "../../server/src/catalog-scan/scanner/catalog-scanner.js";
import { CatalogScanWriter } from "../../server/src/catalog-scan/writer/catalog-scan-writer.js";

let prober: ControlledProber | undefined;
test.afterEach(async () => {
  prober?.resolveAll(PROBE_RESULT);
  await cleanUpTestEnvironment();
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
    prober = new ControlledProber();
    const controlled = prober;
    const { server } = await startTestServer({
      plex: { publicBaseUrl: "http://northwoods.lan:3000" },
      overrides: (db, { mediaRoots }) => ({
        scanner: new CatalogScanner({
          roots: mediaRoots,
          prober: controlled,
          writer: new CatalogScanWriter(db),
        }),
      }),
    });
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

    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name: "Media Library", exact: true })
      .click();
    const media = page.getByRole("region", {
      name: "Media Library",
      exact: true,
    });
    await media.getByLabel("Absolute server path").fill(directory);
    await media.getByRole("button", { name: "Add root", exact: true }).click();
    await expect(
      media.getByRole("button", { name: "Scan", exact: true }),
    ).toBeVisible();
    await media.getByRole("button", { name: "Scan", exact: true }).click();
    await controlled.waitForStarted(1);
    controlled.resolveAll({ ...PROBE_RESULT, durationMs: 1_200_000 });
    await expect(
      media.getByText("Completed scan", { exact: true }),
    ).toBeVisible();
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
      .getByLabel("New collection name")
      .fill("Northwoods collection");
    await collections
      .getByRole("button", { name: "Create collection" })
      .click();
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
    await channels.getByLabel("Channel number", { exact: true }).fill("69");
    await channels
      .getByLabel("Channel name", { exact: true })
      .fill("Northwoods TV");
    await channels
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
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

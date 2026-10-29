import { expect, test } from "@playwright/test";
import { cleanUpTestEnvironment } from "../../server/src/testing/test-environment.js";
import { startScheduleScenarioServer } from "../../server/src/testing/schedule-server.js";
import {
  detachBrowserApi,
  injectBrowserApi,
} from "../src/testing/injected-api.js";

test.afterEach(async ({ page }) => {
  await detachBrowserApi(page);
  await cleanUpTestEnvironment();
});

/** A guide program with only a title, as media without content facts reads. */
const program = (title: string) => ({
  title,
  subTitle: null,
  description: null,
  releaseDate: null,
  kind: null,
  genres: [],
  posterUrl: null,
  episode: null,
});

/**
 * A program two minutes long is eight pixels wide in the guide, narrower
 * than a block's padding. Only real layout shows whether it can still be
 * clicked and highlighted, so the schedule window answers with one between
 * two long programs; the rest of the API is the real server.
 */
test("a program only minutes long can still be hovered and opened in the guide", async ({
  page,
}) => {
  const { server } = await startScheduleScenarioServer();
  await injectBrowserApi(page, server);
  // Registered after the API route, so it answers the schedule window first.
  await page.route("http://127.0.0.1:3000/channels/*/schedule?*", (route) => {
    const start = Date.parse(
      new URL(route.request().url()).searchParams.get("start")!,
    );
    const at = (minutes: number) =>
      new Date(start + minutes * 60_000).toISOString();
    const entry = (id: string, from: number, to: number, title: string) => ({
      id,
      title,
      startsAt: at(from),
      endsAt: at(to),
      program: program(title),
    });
    return route.fulfill({
      json: {
        scheduleRevision: 1,
        entries: [
          entry("long-1", 0, 40, "Fancy Nancy"),
          entry("short", 40, 42, "Olaf Presents"),
          entry("long-2", 42, 80, "Curious George"),
        ],
        fillerIntervals: [],
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Program Guide", exact: true })
    .click();
  const guide = page.getByRole("region", {
    name: "Program Guide",
    exact: true,
  });
  const short = guide.getByRole("button", { name: /^Olaf Presents/ });
  // The block is the button's list item, which draws its border.
  const block = short.locator("xpath=..");

  // The button fills its eight-pixel block, so the pointer finds it.
  const box = await short.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(7);
  const resting = await block.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await short.hover();
  await expect
    .poll(() =>
      block.evaluate((element) => getComputedStyle(element).borderColor),
    )
    .not.toBe(resting);
  await short.click();
  await expect(
    guide.getByRole("dialog", { name: "Olaf Presents" }),
  ).toBeVisible();
});

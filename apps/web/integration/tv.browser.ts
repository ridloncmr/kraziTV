import { readFile } from "node:fs/promises";
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

/**
 * TV plays a channel's MPEG-TS stream through mpegts.js and Media Source
 * Extensions in real Chromium. The browser test job has no FFmpeg, so the
 * stream route answers with three seconds of a committed test pattern; the
 * rest of the API is the real server.
 */
test("TV plays a channel's stream in the browser and says when the broadcast stops", async ({
  page,
}) => {
  const { server } = await startScheduleScenarioServer();
  await injectBrowserApi(page, server);
  const pattern = await readFile(
    new URL("fixtures/test-pattern.mpegts", import.meta.url),
  );
  const streams: string[] = [];
  // Registered after the API route, so it answers the stream route first.
  await page.route("http://127.0.0.1:3000/channels/*/stream", (route) => {
    streams.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "video/MP2T",
        "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      },
      body: pattern,
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "TV", exact: true })
    .click();
  const tv = page.getByRole("region", { name: "TV", exact: true });
  const video = tv.getByLabel("69 Example Channel");

  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(1);
  expect(streams).toEqual(["/channels/channel-fixture-001/stream"]);
  expect(
    await video.evaluate(
      (element: HTMLVideoElement) =>
        element.getVideoPlaybackQuality().totalVideoFrames,
    ),
  ).toBeGreaterThan(20);
  // The pattern's three seconds end the response, as a stopped broadcast does.
  await expect(tv.getByRole("alert")).toContainText("The broadcast stopped.");
});

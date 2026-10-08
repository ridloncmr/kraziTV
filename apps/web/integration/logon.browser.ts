import { expect, test } from "@playwright/test";
import { signIn } from "../../server/src/testing/api-requests.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../server/src/testing/test-environment.js";
import { injectBrowserApi } from "../src/testing/injected-api.js";

test.afterEach(async () => {
  await cleanUpTestEnvironment();
});

test("logs on from the keyboard against the real gate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer({ auth: "real" });
  // The account exists, but this browser holds no session.
  await signIn(server);
  await injectBrowserApi(page, server, { signedIn: false });
  await page.goto("/");
  const logon = page.getByRole("main", { name: "Log on to kraziTV" });
  const tile = logon.getByRole("button", { name: "Owner" });
  await expect(tile).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(tile).toBeFocused();
  await page.keyboard.press("Enter");
  const box = logon.getByLabel("Type your password");
  await expect(box).toBeFocused();

  await page.keyboard.type("wrong password");
  await page.keyboard.press("Enter");
  await expect(logon.getByRole("alert")).toContainText(
    "Did you forget your password?",
  );
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();

  await page.keyboard.type("correct horse");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "start", exact: true }),
  ).toBeVisible();
  // A gated route answers, so the login's cookie reached the browser.
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Media Library", exact: true })
      .getByText(/No media roots yet/),
  ).toBeVisible();
});

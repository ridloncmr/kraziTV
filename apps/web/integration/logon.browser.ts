import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../../server/src/testing/api-requests.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../server/src/testing/test-environment.js";
import { injectBrowserApi } from "../src/testing/injected-api.js";

test.afterEach(async () => {
  await cleanUpTestEnvironment();
});

/**
 * Waits for the desktop and opens Media Library, whose gated reads answer only
 * when the session cookie the server set reached the browser.
 */
async function expectSignedInDesktop(page: Page) {
  await expect(
    page.getByRole("button", { name: "start", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Media Library", exact: true })
      .getByText(/No media roots yet/),
  ).toBeVisible();
}

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
  await expectSignedInDesktop(page);
});

test("sets up the account on first run from the keyboard against the real gate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { server } = await startTestServer({ auth: "real" });
  await injectBrowserApi(page, server, { signedIn: false });
  await page.goto("/");
  const setup = page.getByRole("main", { name: "Set up kraziTV" });
  await expect(setup.getByLabel("Your name")).toBeFocused();

  await page.keyboard.type("  Marguerite  ");
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct horse");
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct horsf");
  await page.keyboard.press("Enter");
  await expect(setup.getByRole("alert")).toHaveText(
    "The passwords you typed do not match.",
  );

  await setup.getByLabel("Confirm password").fill("correct horse");
  await page.keyboard.press("Enter");
  await expectSignedInDesktop(page);
  await expect(
    server.inject("/auth/state").then((r) => r.json<unknown>()),
  ).resolves.toMatchObject({
    account: { displayName: "Marguerite" },
  });
});

test("returns to the logon screen when the session ends while the desktop is open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer({ auth: "real" });
  await injectBrowserApi(page, server);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "start", exact: true }),
  ).toBeVisible();

  // Another browser logs this session out, so the next gated read answers 401.
  const [session] = await page.context().cookies("http://127.0.0.1:3000");
  const logout = await server.inject({
    method: "POST",
    url: "/auth/logout",
    headers: { cookie: `${session.name}=${session.value}` },
  });
  expect(logout.statusCode).toBe(204);

  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Media Library", exact: true })
    .click();
  await expect(
    page
      .getByRole("main", { name: "Log on to kraziTV" })
      .getByRole("button", { name: "Owner" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Media Library", exact: true }),
  ).toBeHidden();
});

import { expect, test, type Page } from "@playwright/test";
import {
  SIGN_IN_PASSWORD,
  signIn,
} from "../../server/src/testing/api-requests.js";
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
  // A server refusal re-enables the form with focus back in it, not on <body>.
  const refuseSetup = "http://127.0.0.1:3000/auth/setup";
  await page.route(refuseSetup, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "invalid_request", message: "Refused for the test" },
      }),
    }),
  );
  await page.keyboard.press("Enter");
  await expect(setup.getByRole("alert")).toHaveText("Refused for the test");
  await expect(setup.getByLabel("Your name")).toBeFocused();
  await page.unroute(refuseSetup);

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

test("logs off from Start and stays logged off after a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer({ auth: "real" });
  await injectBrowserApi(page, server);
  await page.goto("/");
  const start = page.getByRole("button", { name: "start", exact: true });
  const confirmation = page.getByRole("dialog", { name: "Log Off kraziTV" });

  // Cancel first: the desktop stays and focus returns to Start.
  await start.click();
  await page
    .getByRole("navigation", { name: "Start programs" })
    .getByRole("button", { name: "Log Off" })
    .click();
  await expect(
    confirmation.getByRole("button", { name: "Log Off" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(start).toBeFocused();

  await start.click();
  await page
    .getByRole("navigation", { name: "Start programs" })
    .getByRole("button", { name: "Log Off" })
    .click();
  await page.keyboard.press("Enter");
  const tile = page
    .getByRole("main", { name: "Log on to kraziTV" })
    .getByRole("button", { name: "Owner" });
  await expect(tile).toBeVisible();

  // The server cleared the cookie, so a reload asks again and is still out.
  await page.reload();
  await expect(tile).toBeVisible();
});

test("changes the password from Account Settings, then logs on with it after logging off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer({ auth: "real" });
  await injectBrowserApi(page, server);
  await page.goto("/");
  await page
    .getByLabel("Desktop programs")
    .getByRole("button", { name: "Account Settings", exact: true })
    .click();
  const settings = page.getByRole("region", {
    name: "Account Settings",
    exact: true,
  });
  await settings.getByRole("button", { name: "Change my password" }).click();
  await settings.getByLabel("Current password").fill(SIGN_IN_PASSWORD);
  await settings
    .getByLabel("New password", { exact: true })
    .fill("battery staple");
  await settings.getByLabel("Confirm new password").fill("battery staple");
  await settings.getByRole("button", { name: "Change Password" }).click();
  // Success returns home, and the desktop stays: this session survived.
  await expect(
    settings.getByRole("button", { name: "Change my password" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "start", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Start programs" })
    .getByRole("button", { name: "Log Off" })
    .click();
  await page
    .getByRole("dialog", { name: "Log Off kraziTV" })
    .getByRole("button", { name: "Log Off" })
    .click();
  const logon = page.getByRole("main", { name: "Log on to kraziTV" });
  await logon.getByRole("button", { name: "Owner" }).click();
  await logon.getByLabel("Type your password").fill("battery staple");
  await page.keyboard.press("Enter");
  await expectSignedInDesktop(page);
});

test("keeps a failed log off dismissable from the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { server } = await startTestServer({ auth: "real" });
  await injectBrowserApi(page, server);
  // Registered after the transport, so this route answers logout first.
  await page.route("http://127.0.0.1:3000/auth/logout", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "offline", message: "Down" } }),
    }),
  );
  await page.goto("/");
  const start = page.getByRole("button", { name: "start", exact: true });
  await start.click();
  await page
    .getByRole("navigation", { name: "Start programs" })
    .getByRole("button", { name: "Log Off" })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Log Off kraziTV" });
  await page.keyboard.press("Enter");
  await expect(confirmation.getByRole("alert")).toBeVisible();
  // Disabling the pressed button dropped focus; it must come back to it.
  await expect(
    confirmation.getByRole("button", { name: "Log Off" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(start).toBeFocused();
});

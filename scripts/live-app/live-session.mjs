// Opens the owner's running kraziTV web app in headless Chromium with a
// logged-in session, so an agent can look at the live desktop shell.
//
// The password comes from `.env.agent` (gitignored) as `KRAZITV_PASSWORD`.
// The session is saved under `data/live-app/` and reused until the server
// stops accepting it, so repeated runs do not log in again.

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const passwordFile = join(repoRoot, ".env.agent");
const stateDir = join(repoRoot, "data", "live-app");
const storageStatePath = join(stateDir, "storage-state.json");

/**
 * The owner's running kraziTV. Another instance, such as the demo library
 * the wiki screenshots use, passes its own origins, password, and session
 * file, so the two never share a cookie.
 */
const LIVE_APP = {
  webUrl: process.env.KRAZITV_WEB_URL ?? "http://127.0.0.1:5173",
  apiUrl: process.env.KRAZITV_API_URL ?? "http://127.0.0.1:3000",
  password: readPassword,
  storageStatePath,
};

/**
 * Launches Chromium on the live web app with a valid session. Logs in only
 * when the saved session is missing or rejected, and never retries a failed
 * login, because repeated wrong passwords trip the server's throttle.
 */
export async function openLiveApp({
  width = 1440,
  height = 900,
  app = LIVE_APP,
  timezoneId,
} = {}) {
  const browser = await chromium.launch({ headless: true });
  const saved = existsSync(app.storageStatePath)
    ? app.storageStatePath
    : undefined;
  const context = await browser.newContext({
    viewport: { width, height },
    storageState: saved,
    timezoneId,
  });
  try {
    if (!(await isAuthenticated(context, app))) {
      await logIn(context, app);
      mkdirSync(dirname(app.storageStatePath), { recursive: true });
      await context.storageState({ path: app.storageStatePath });
      // The file holds a live session cookie, so only the owner may read it.
      chmodSync(app.storageStatePath, 0o600);
    }
    const page = await context.newPage();
    await page.goto(app.webUrl);
    await page
      .getByRole("button", { name: "start", exact: true })
      .waitFor({ timeout: 15_000 });
    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Asks the server whether the context's cookie is still a live session. */
async function isAuthenticated(context, app) {
  const response = await context.request.get(`${app.apiUrl}/auth/state`);
  if (!response.ok()) {
    throw new Error(
      `kraziTV server at ${app.apiUrl} answered ${response.status()}`,
    );
  }
  const state = await response.json();
  return state.authenticated === true;
}

/**
 * Logs in with the instance's password. Sends the web
 * app's origin, because the auth gate refuses writes from other origins.
 */
async function logIn(context, app) {
  const response = await context.request.post(`${app.apiUrl}/auth/login`, {
    headers: { origin: app.webUrl },
    data: { password: app.password() },
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Login failed (${response.status()}): ${body}`);
  }
}

/** Reads `KRAZITV_PASSWORD` from `.env.agent`, failing with what to fix. */
function readPassword() {
  if (existsSync(passwordFile)) process.loadEnvFile(passwordFile);
  const password = process.env.KRAZITV_PASSWORD;
  if (!password) {
    throw new Error(
      `Set KRAZITV_PASSWORD in ${passwordFile} to the kraziTV account password.`,
    );
  }
  return password;
}

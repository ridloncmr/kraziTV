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

export const WEB_URL = process.env.KRAZITV_WEB_URL ?? "http://127.0.0.1:5173";
const API_URL = process.env.KRAZITV_API_URL ?? "http://127.0.0.1:3000";

/**
 * Launches Chromium on the live web app with a valid session. Logs in only
 * when the saved session is missing or rejected, and never retries a failed
 * login, because repeated wrong passwords trip the server's throttle.
 */
export async function openLiveApp({ width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch({ headless: true });
  const saved = existsSync(storageStatePath) ? storageStatePath : undefined;
  const context = await browser.newContext({
    viewport: { width, height },
    storageState: saved,
  });
  try {
    if (!(await isAuthenticated(context))) {
      await logIn(context);
      mkdirSync(stateDir, { recursive: true });
      await context.storageState({ path: storageStatePath });
      // The file holds a live session cookie, so only the owner may read it.
      chmodSync(storageStatePath, 0o600);
    }
    const page = await context.newPage();
    await page.goto(WEB_URL);
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
async function isAuthenticated(context) {
  const response = await context.request.get(`${API_URL}/auth/state`);
  if (!response.ok()) {
    throw new Error(
      `kraziTV server at ${API_URL} answered ${response.status()}`,
    );
  }
  const state = await response.json();
  return state.authenticated === true;
}

/**
 * Logs in as the owner with the password from `.env.agent`. Sends the web
 * app's origin, because the auth gate refuses writes from other origins.
 */
async function logIn(context) {
  const response = await context.request.post(`${API_URL}/auth/login`, {
    headers: { origin: WEB_URL },
    data: { password: readPassword() },
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

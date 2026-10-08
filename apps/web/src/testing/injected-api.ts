import type { Page } from "@playwright/test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { signIn } from "../../../server/src/testing/api-requests.js";

/**
 * Browser transport reaches real Fastify routes and SQLite through injection,
 * without binding a test API port. By default it also sets up the account and
 * puts its session cookie in the browser, so the app boots to the desktop;
 * pass `signedIn: false` to leave the browser at the logon or setup screen.
 */
export async function injectBrowserApi(
  page: Page,
  server: FastifyInstance,
  options: { signedIn?: boolean } = {},
): Promise<void> {
  await page.route("http://127.0.0.1:3000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // allHeaders, unlike headers, includes the cookie and origin the gate reads.
    const response = await server.inject({
      method: request.method() as InjectOptions["method"],
      url: `${url.pathname}${url.search}`,
      headers: await request.allHeaders(),
      payload: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.join("\n") : String(value),
        ]),
      ),
      body: response.body,
    });
  });
  if (options.signedIn === false) return;
  const [name, value] = (await signIn(server)).cookie.split("=");
  await page.context().addCookies([
    {
      name,
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

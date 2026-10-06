import type { Page } from "@playwright/test";
import type { FastifyInstance, InjectOptions } from "fastify";

/** Browser transport reaches real Fastify routes and SQLite through injection, without binding a test API port. */
export async function injectBrowserApi(
  page: Page,
  server: FastifyInstance,
): Promise<void> {
  await page.route("http://127.0.0.1:3000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await server.inject({
      method: request.method() as InjectOptions["method"],
      url: `${url.pathname}${url.search}`,
      headers: request.headers(),
      payload: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: response.statusCode,
      contentType: String(
        response.headers["content-type"] ?? "application/json",
      ),
      body: response.body,
    });
  });
}

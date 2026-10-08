import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { apiRequest } from "./api-client.js";
import { ApiError } from "./api-error.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("asks the browser to send the session cookie on reads and writes", async () => {
  const api = new BrowserApi();
  api.reply("/channels", []);
  api.reply("/auth/login", {}, "POST");
  vi.stubGlobal("fetch", api.fetch);

  await apiRequest("/channels");
  await apiRequest("/auth/login", { method: "POST", body: { password: "x" } });

  expect(api.requests.map((request) => request.credentials)).toEqual([
    "include",
    "include",
  ]);
});

it("keeps the HTTP status and the envelope's details on an API error", async () => {
  const api = new BrowserApi();
  api.reply(
    "/auth/login",
    {
      error: {
        code: "too_many_attempts",
        message: "Wait",
        retryAfterSeconds: 7,
      },
    },
    "POST",
    429,
  );
  vi.stubGlobal("fetch", api.fetch);

  const failure = await apiRequest("/auth/login", {
    method: "POST",
    body: { password: "x" },
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({
    code: "too_many_attempts",
    message: "Wait",
    status: 429,
    details: { retryAfterSeconds: 7 },
  });
});

it("keeps the HTTP status when the error body is not an API envelope", async () => {
  const api = new BrowserApi();
  api.handle(
    "/health",
    () => new Response("<html>Bad gateway</html>", { status: 502 }),
  );
  vi.stubGlobal("fetch", api.fetch);

  await expect(apiRequest("/health")).rejects.toMatchObject({
    code: "request_failed",
    status: 502,
  });
});

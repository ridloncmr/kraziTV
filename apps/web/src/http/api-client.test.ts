import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { apiRequest, onUnauthorized } from "./api-client.js";
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

it("reports each 401 to the registered listener and still throws it", async () => {
  const api = new BrowserApi();
  const unauthenticated = {
    error: { code: "unauthenticated", message: "Log in first" },
  };
  api.reply("/channels", unauthenticated, "GET", 401);
  api.reply(
    "/media-roots",
    { error: { code: "forbidden_origin" } },
    "GET",
    403,
  );
  vi.stubGlobal("fetch", api.fetch);
  const listener = vi.fn();
  const unregister = onUnauthorized(listener);

  await expect(apiRequest("/channels")).rejects.toMatchObject({
    code: "unauthenticated",
    status: 401,
  });
  await expect(apiRequest("/media-roots")).rejects.toMatchObject({
    status: 403,
  });
  expect(listener).toHaveBeenCalledTimes(1);

  unregister();
  await expect(apiRequest("/channels")).rejects.toMatchObject({ status: 401 });
  expect(listener).toHaveBeenCalledTimes(1);
});

it("never reports a 401 its caller already aborted", async () => {
  const api = new BrowserApi();
  api.hold("/channels");
  vi.stubGlobal("fetch", api.fetch);
  const listener = vi.fn();
  const unregister = onUnauthorized(listener);
  const controller = new AbortController();

  const request = apiRequest("/channels", { signal: controller.signal });
  await vi.waitFor(() => expect(api.requests).toHaveLength(1));
  controller.abort();
  // The held transport ignores abort, like a reply already on its way.
  api.release("/channels", { error: { code: "unauthenticated" } }, "GET", 401);

  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(listener).not.toHaveBeenCalled();
  unregister();
});

it("keeps a newer listener when an older one unregisters", async () => {
  const api = new BrowserApi();
  api.reply("/channels", { error: { code: "unauthenticated" } }, "GET", 401);
  vi.stubGlobal("fetch", api.fetch);
  const older = vi.fn();
  const newer = vi.fn();
  const unregisterOlder = onUnauthorized(older);
  const unregisterNewer = onUnauthorized(newer);
  unregisterOlder();

  await expect(apiRequest("/channels")).rejects.toMatchObject({ status: 401 });
  expect(older).not.toHaveBeenCalled();
  expect(newer).toHaveBeenCalledTimes(1);
  unregisterNewer();
});

// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "../../http/api-client.js";
import { toError } from "../../http/to-error.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { RequestFeedback } from "./request-feedback.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A request that fails before the server answers, as the feedback box receives it.
async function failedRequest(failure: Error): Promise<Error> {
  const api = new BrowserApi();
  api.handle("/channels", () => {
    throw failure;
  });
  vi.stubGlobal("fetch", api.fetch);
  return apiRequest("/channels").then(
    () => new Error("unexpectedly answered"),
    (error: unknown) => toError(error),
  );
}

it("says kraziTV can't be reached, never the browser's words, when a request never reaches the server", async () => {
  for (const failure of [
    new TypeError("Failed to fetch"),
    new DOMException("signal timed out", "TimeoutError"),
  ]) {
    const error = await failedRequest(failure);
    render(createElement(RequestFeedback, { error }));

    expect(screen.getByRole("alert").textContent).toBe(
      "Can't reach kraziTV. Check that it is running, then press Refresh.",
    );
    cleanup();
  }
});

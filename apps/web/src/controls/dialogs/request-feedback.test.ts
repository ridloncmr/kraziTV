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

// The error a request ends in, as the feedback box receives it, when the
// transport answers with `answer`.
async function requestError(
  answer: (api: BrowserApi) => Response,
): Promise<Error> {
  const api = new BrowserApi();
  api.handle("/channels", () => answer(api));
  vi.stubGlobal("fetch", api.fetch);
  return apiRequest("/channels").then(
    () => new Error("unexpectedly answered"),
    (error: unknown) => toError(error),
  );
}

// A request that fails before the server answers.
const failedRequest = (failure: Error) =>
  requestError(() => {
    throw failure;
  });

// A refusal as the server sends it: details beside the code and message.
const refusedRequest = (status: number, error: Record<string, unknown>) =>
  requestError((api) => api.response({ error }, status));

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

it("says what to do when kraziTV fails, never the server's words", async () => {
  const error = await refusedRequest(500, {
    code: "internal_error",
    message: "Internal server error",
  });
  render(createElement(RequestFeedback, { error }));

  expect(screen.getByRole("alert").textContent).toBe(
    "kraziTV hit a problem it could not recover from. Try again; if it keeps happening, check the kraziTV log.",
  );
});

it("says to try again in a moment while the schedule is busy", async () => {
  const error = await refusedRequest(503, {
    code: "schedule_busy",
    message: "The schedule is busy; retry the request",
    retryable: true,
  });
  render(createElement(RequestFeedback, { error }));

  expect(screen.getByRole("alert").textContent).toBe(
    "kraziTV is busy updating this channel's schedule. Try again in a moment.",
  );
});

it("says a show removed elsewhere is no longer in the lineup", async () => {
  const error = await refusedRequest(404, {
    code: "programming_assignment_not_found",
    message: "This channel has no such programming assignment",
  });
  render(createElement(RequestFeedback, { error }));

  expect(screen.getByRole("alert").textContent).toBe(
    "That show is no longer in the lineup. Refresh and pick again.",
  );
});

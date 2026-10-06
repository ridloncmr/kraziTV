// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { ChannelsApp } from "./channels-app.js";
import { ProgrammingEditor } from "./programming-editor.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps a saved delete absent and retries cleanup on the same ID", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.handle(
    "/channels/one",
    () => {
      // The failed follow-up read must not turn a committed delete back into an enabled row.
      api.reply(
        "/channels",
        { error: { code: "offline", message: "Follow-up read failed" } },
        "GET",
        503,
      );
      return api.response(
        {
          error: {
            code: "channel_runtime_cleanup_failed",
            message: "Channel was deleted but cleanup did not finish",
            channelId: "one",
            operation: "delete",
            persistenceCommitted: true,
            retryable: true,
          },
        },
        503,
      );
    },
    "DELETE",
  );
  vi.stubGlobal("fetch", api.fetch);
  const view = render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Delete channel permanently" }),
  );
  await screen.findByText("Channel deleted. Configuration saved.");
  await screen.findByText(/No channels yet/);
  view.unmount();
  render(createElement(ChannelsApp, { visible: true }));
  expect(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  ).toBeTruthy();
  api.reply("/channels/one", undefined, "DELETE", 204);
  api.reply("/channels", []);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry runtime cleanup" }),
    ).toBeNull(),
  );
  expect(
    api.requests
      .filter((request) => request.method === "DELETE")
      .map((request) => request.path),
  ).toEqual(["/channels/one", "/channels/one"]);
  expect(api.requests.some((request) => request.method === "POST")).toBe(false);
});

it("reports a rejected re-enable as still disabled, then retries its earlier stop", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [{ ...adminFixtures.channels[0], enabled: false }]);
  api.reply(
    "/channels/one",
    {
      error: {
        code: "channel_runtime_cleanup_failed",
        message: "Earlier cleanup must finish before enabling",
        channelId: "one",
        operation: "disable",
        persistenceCommitted: false,
      },
    },
    "PATCH",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
  await screen.findByText("Channel remains disabled. Re-enable was not saved.");
  api.reply(
    "/channels/one",
    { ...adminFixtures.channels[0], enabled: false },
    "PATCH",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry runtime cleanup" }),
    ).toBeNull(),
  );
  expect(
    api.requests
      .filter((request) => request.method === "PATCH")
      .map((request) => request.body),
  ).toEqual([{ enabled: true }, { enabled: false }]);
});

it("single-item programming sends no collection playback mode and reloads the backend schedule", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-blocks", []);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/media-items", adminFixtures.media);
  api.reply(
    "/channels/one/programming-blocks",
    { id: "block", source: { kind: "media_item", mediaItemId: "z" } },
    "POST",
  );
  api.reply("/channels/one/schedule", { scheduleRevision: 9, entries: [] });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  await screen.findByText(/No programming block/);
  fireEvent.change(screen.getByLabelText("Source type"), {
    target: { value: "media_item" },
  });
  fireEvent.change(screen.getByLabelText("Programming source"), {
    target: { value: "z" },
  });
  expect(screen.queryByLabelText("Playback mode")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save programming" }));
  await screen.findByText(/revision 9/);
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ source: { kind: "media_item", mediaItemId: "z" } });
});

it("preserves an unsaved programming mode across minimize and restore", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-blocks", [
    {
      id: "block",
      source: {
        kind: "collection",
        mediaCollectionId: "favorites",
        playbackMode: "chronological",
      },
    },
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/media-items", adminFixtures.media);
  vi.stubGlobal("fetch", api.fetch);
  const view = render(
    createElement(ProgrammingEditor, { channelId: "one", visible: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLSelectElement>("Programming source").value,
    ).toBe("favorites"),
  );
  fireEvent.change(screen.getByLabelText("Playback mode"), {
    target: { value: "random" },
  });
  view.rerender(
    createElement(ProgrammingEditor, { channelId: "one", visible: false }),
  );
  view.rerender(
    createElement(ProgrammingEditor, { channelId: "one", visible: true }),
  );
  await waitFor(() =>
    expect(
      api.requests.filter((request) =>
        request.path.endsWith("programming-blocks"),
      ),
    ).toHaveLength(2),
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Playback mode").value).toBe(
    "random",
  );
});

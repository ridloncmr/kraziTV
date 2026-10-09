// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ALIEN, FIREFLY } from "../../testing/admin-fixtures.js";
import {
  openCorrection,
  typeCorrection as type,
  showMediaLibrary,
} from "../../testing/media-library-actions.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CORRECTION = `/metadata/corrections/${encodeURIComponent(FIREFLY.id)}`;

it("sends only changed fields, clears an emptied one, and shows the corrected item", async () => {
  const api = await showMediaLibrary([FIREFLY]);
  api.reply(
    CORRECTION,
    {
      ...FIREFLY,
      metadata: {
        ...FIREFLY.metadata,
        title: "Safe",
        episodeNumber: 7,
        lastEpisodeNumber: 7,
        tags: ["space western", "heist"],
        correctedFields: ["title", "episodeNumber"],
      },
    },
    "PATCH",
  );
  const listReads = api.requestsTo("/media-items").length;

  const form = openCorrection(FIREFLY.title);
  expect(form.getByLabelText<HTMLInputElement>("Series").value).toBe("Firefly");
  type(form, "Title", "Safe");
  type(form, "Episode", "7");
  type(form, "Series", "");
  type(form, "Tags", " space western, heist ,, ");
  fireEvent.click(form.getByRole("button", { name: "Save" }));

  const details = within(
    await screen.findByRole("dialog", { name: "Media details" }),
  );
  expect(api.requestsTo(CORRECTION).map((request) => request.body)).toEqual([
    {
      title: "Safe",
      seriesName: null,
      episodeNumber: 7,
      tags: ["space western", "heist"],
    },
  ]);
  expect(details.getByText("Season 1, episode 7")).toBeTruthy();
  expect(details.getByText("space western, heist")).toBeTruthy();
  expect(details.getAllByText("(your correction)")).toHaveLength(2);
  await waitFor(() =>
    expect(api.requestsTo("/media-items").length).toBeGreaterThan(listReads),
  );
});

it("closes without a request when nothing changed", async () => {
  const api = await showMediaLibrary([ALIEN]);

  const form = openCorrection(ALIEN.title);
  fireEvent.click(form.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("dialog", { name: "Media details" })).toBeTruthy();
  expect(api.requests.filter((request) => request.method === "PATCH")).toEqual(
    [],
  );
});

it("keeps the form open with the server's reason when the item was removed meanwhile", async () => {
  const api = await showMediaLibrary([FIREFLY]);
  api.reply(
    CORRECTION,
    {
      error: {
        code: "media_item_not_found",
        message: "Media item Firefly does not exist",
      },
    },
    "PATCH",
    404,
  );

  const form = openCorrection(FIREFLY.title);
  type(form, "Title", "Safe");
  fireEvent.click(form.getByRole("button", { name: "Save" }));

  expect(
    await form.findByText("Media item Firefly does not exist", {
      exact: false,
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Media details" })).toBeNull();
});

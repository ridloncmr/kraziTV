// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ALIEN,
  DISC_TRACK,
  TRACK_FOLDER,
} from "../../testing/admin-fixtures.js";
import {
  openMediaDetails,
  openMapping,
  showMediaLibrary,
} from "../../testing/media-library-actions.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MAPPING = `/metadata/track-mappings/${encodeURIComponent(DISC_TRACK.id)}`;

it("offers no mapping when the server refuses it without a TMDB key, or for a decided item", async () => {
  const api = await showMediaLibrary([DISC_TRACK, ALIEN]);
  api.reply(
    MAPPING,
    {
      error: {
        code: "tmdb_key_required",
        message: "Set up TMDB in Account Settings first.",
      },
    },
    "GET",
    409,
  );

  const details = within(openMediaDetails(DISC_TRACK.title));
  await waitFor(() => expect(api.requestsTo(MAPPING)).toHaveLength(1));
  expect(
    details.queryByRole("button", { name: "Map tracks to episodes…" }),
  ).toBeNull();
  expect(details.queryByRole("alert")).toBeNull();
  fireEvent.click(details.getByRole("button", { name: "Close" }));

  openMediaDetails(ALIEN.title);
  expect(
    api.requests.filter((request) =>
      request.path.startsWith("/metadata/track-mappings/Alien"),
    ),
  ).toEqual([]);
});

it("searches from the folder's series, proposes rows, and applies the edited rows", async () => {
  const { api, dialog } = await openMapping();
  api.reply(MAPPING, { mappedCount: 2, extraCount: 0, goneCount: 0 }, "POST");

  expect((await dialog.findByLabelText<HTMLInputElement>("Series")).value).toBe(
    "Some Show",
  );
  expect(dialog.getByLabelText<HTMLInputElement>("Season").value).toBe("1");
  fireEvent.click(dialog.getByRole("button", { name: "Search TMDB" }));
  fireEvent.click(
    await dialog.findByRole("radio", { name: "Some Show (2010)" }),
  );
  fireEvent.click(dialog.getByRole("button", { name: "Next" }));

  const second = await dialog.findByRole("combobox", {
    name: "Episode for Disc 1 Track 1",
  });
  expect(api.requestsTo("/metadata/series-search")[0]?.query.get("query")).toBe(
    "Some Show",
  );
  const proposed = api.requestsTo(`${MAPPING}/proposal`)[0]?.query;
  expect(proposed?.get("tmdbSeriesId")).toBe("4242");
  expect(proposed?.get("season")).toBe("1");
  // The first track's runtime shows beside its proposed episode; the
  // skipped extra has none.
  const rows = dialog.getAllByRole("row");
  expect(
    within(rows[1]).getByText("44:00", { selector: "td:last-child" }),
  ).toBeTruthy();
  expect(within(rows[2]).getByText("—")).toBeTruthy();

  fireEvent.change(second, { target: { value: "2" } });
  expect(within(rows[2]).getByText("Unknown")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Map tracks to episodes" }),
    ).toBeNull(),
  );
  expect(
    api.requests.find(
      (request) => request.path === MAPPING && request.method === "POST",
    )?.body,
  ).toEqual({
    tmdbSeriesId: 4242,
    season: 1,
    rows: [
      { mediaItemId: TRACK_FOLDER.tracks[0].mediaItemId, episodeNumber: 1 },
      { mediaItemId: TRACK_FOLDER.tracks[1].mediaItemId, episodeNumber: 2 },
    ],
  });
});

it("sends nothing when cancelled after a proposal", async () => {
  const { api, dialog } = await openMapping();
  fireEvent.click(await dialog.findByRole("button", { name: "Search TMDB" }));
  fireEvent.click(
    await dialog.findByRole("radio", { name: "Some Show (2010)" }),
  );
  fireEvent.click(dialog.getByRole("button", { name: "Next" }));
  await dialog.findByRole("combobox", { name: "Episode for Disc 1 Track 0" });

  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

  expect(
    screen.queryByRole("dialog", { name: "Map tracks to episodes" }),
  ).toBeNull();
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual(
    [],
  );
});

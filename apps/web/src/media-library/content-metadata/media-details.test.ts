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
  CHANGED,
  FIREFLY,
  OUTAGE,
  itemWith,
} from "../../testing/admin-fixtures.js";
import {
  openCorrection,
  openMediaDetails as openDetails,
  showMediaLibrary as showCatalog,
  typeCorrection as type,
} from "../../testing/media-library-actions.js";
import { scanStatus } from "../../testing/scan-fixtures.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTICE =
  "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

/** The listed row showing `title`. */
function rowOf(title: string) {
  return screen.getByText(title).closest("tr")!;
}

it("labels each item's match state, naming a failed lookup apart from unmatched", async () => {
  await showCatalog([
    ALIEN,
    OUTAGE,
    itemWith("The Thing", { matchState: "ambiguous" }),
    itemWith("Nothing", { matchState: "unmatched" }),
    itemWith("Making of", { matchState: "extra" }),
    itemWith("Wrong", { matchState: "rejected" }),
    itemWith("New", { matchState: "not_looked_up" }),
  ]);

  const labels = {
    "Alien (1979)": "Matched",
    Outage: "Lookup failed",
    "The Thing": "Needs your choice",
    Nothing: "Unmatched",
    "Making of": "Extra",
    Wrong: "Rejected",
    New: "Not looked up",
  };
  for (const [title, label] of Object.entries(labels)) {
    expect(within(rowOf(title)).getByText(label)).toBeTruthy();
  }
});

it("shows a matched movie's facts, its TMDB poster, and TMDB's notice", async () => {
  await showCatalog([ALIEN]);

  const dialog = within(openDetails("Alien (1979)"));

  for (const fact of [
    "Alien",
    "1979-05-25",
    "Horror, Science Fiction",
    "Alien Collection",
    "In space…",
  ]) {
    expect(dialog.getByText(fact)).toBeTruthy();
  }
  expect(
    dialog.getByRole("img", { name: "Poster for Alien" }).getAttribute("src"),
  ).toBe("https://image.tmdb.org/t/p/w342/alien.jpg");
  expect(dialog.getByRole("img", { name: "TMDB" })).toBeTruthy();
  expect(dialog.getByText(NOTICE)).toBeTruthy();
});

it("names both episodes of a multi-episode file and its series poster", async () => {
  await showCatalog([FIREFLY]);

  const dialog = within(openDetails(FIREFLY.title));

  expect(dialog.getByText("Season 1, episodes 5–6")).toBeTruthy();
  expect(dialog.getByText("Safe / Our Mrs. Reynolds")).toBeTruthy();
  expect(
    dialog.getByRole("img", { name: "Poster for Firefly" }).getAttribute("src"),
  ).toBe("https://image.tmdb.org/t/p/w342/firefly.jpg");
});

it("shows a failed lookup's error without TMDB's notice, since no TMDB facts appear", async () => {
  await showCatalog([OUTAGE]);

  const dialog = within(openDetails("Outage"));

  expect(dialog.getByText("TMDB answered HTTP 503")).toBeTruthy();
  expect(dialog.queryByText(NOTICE)).toBeNull();
  expect(dialog.queryByRole("img")).toBeNull();
});

it("says when a matched item's TMDB data expired, and shows a failed refresh's error", async () => {
  const expired = {
    ...ALIEN,
    metadata: {
      ...ALIEN.metadata,
      title: null,
      refreshError: "TMDB answered HTTP 404",
      tmdbDataExpired: true,
    },
  };
  await showCatalog([expired]);

  const dialog = within(openDetails("Alien (1979)"));

  expect(dialog.getByText("Matched")).toBeTruthy();
  expect(dialog.getByText("TMDB answered HTTP 404")).toBeTruthy();
  expect(
    dialog.getByText(
      "TMDB data expired. It will refresh when TMDB is reachable.",
    ),
  ).toBeTruthy();
  expect(dialog.queryByText(/TMDB data refreshed/)).toBeNull();
});

it("says when a matched item's TMDB data was last refreshed", async () => {
  await showCatalog([ALIEN]);

  const dialog = within(openDetails("Alien (1979)"));

  expect(dialog.getByText(/TMDB data refreshed/)).toBeTruthy();
  expect(dialog.queryByText(/TMDB data expired/)).toBeNull();
});

it("opens details without selecting the row, and Close returns to the list", async () => {
  await showCatalog([ALIEN]);

  openDetails("Alien (1979)");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Select Alien (1979)",
    }).checked,
  ).toBe(false);
  expect(screen.queryByText(NOTICE)).toBeNull();
});

it("retries an item's lookup and opens the progress dialog at enriching", async () => {
  const api = await showCatalog([OUTAGE]);
  const retry = scanStatus({
    kind: "retry",
    phase: "enriching",
    lookupCount: 1,
  });
  api.reply("/metadata/lookup-retries", retry, "POST", 202);
  api.reply("/media-roots/root/scan", retry);

  fireEvent.click(
    within(openDetails("Outage")).getByRole("button", { name: "Retry lookup" }),
  );
  const progress = await screen.findByRole("dialog", {
    name: "Retrying TMDB lookups",
  });

  expect(within(progress).getByRole("status").textContent).toBe(
    "Looking up media on TMDB…",
  );
  expect(within(progress).getByText("0 of 1 looked up")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Media details" })).toBeNull();
  expect(api.requestsTo("/metadata/lookup-retries")).toMatchObject([
    { method: "POST", body: { scope: "item", mediaItemId: OUTAGE.id } },
  ]);
});

it("offers no lookup retry for an extra", async () => {
  await showCatalog([itemWith("Making of", { matchState: "extra" })]);

  const dialog = within(openDetails("Making of"));

  expect(dialog.queryByRole("button", { name: "Retry lookup" })).toBeNull();
  expect(
    dialog.queryByRole("button", { name: "Retry folder lookups" }),
  ).toBeNull();
});

it("flags a file changed since it was matched in the list and its details", async () => {
  await showCatalog([CHANGED]);

  expect(within(rowOf("Alien (1979)")).getByText("File changed")).toBeTruthy();
  const dialog = within(openDetails("Alien (1979)"));

  expect(dialog.getByRole("status").textContent).toBe(
    "File changed since it was matched",
  );
  expect(dialog.getByRole("button", { name: "Keep match" })).toBeTruthy();
  expect(dialog.getByRole("button", { name: "Correct details…" })).toBeTruthy();
});

it("offers no Keep match for an unchanged file", async () => {
  await showCatalog([ALIEN]);

  const dialog = within(openDetails("Alien (1979)"));

  expect(dialog.queryByRole("button", { name: "Keep match" })).toBeNull();
  expect(dialog.queryByText("File changed since it was matched")).toBeNull();
});

it("keeps a changed file's match and shows the item without the flag", async () => {
  const api = await showCatalog([CHANGED]);
  const keep = `/metadata/matches/${encodeURIComponent(CHANGED.id)}/keep`;
  api.reply(keep, ALIEN, "POST");

  fireEvent.click(
    within(openDetails("Alien (1979)")).getByRole("button", {
      name: "Keep match",
    }),
  );

  const details = within(
    await screen.findByRole("dialog", { name: "Media details" }),
  );
  await waitFor(() =>
    expect(details.queryByText("File changed since it was matched")).toBeNull(),
  );
  expect(details.getByText("Matched")).toBeTruthy();
  expect(api.requestsTo(keep)).toMatchObject([{ method: "POST" }]);
});

it("clears a changed file's flag when the owner saves a correction", async () => {
  const api = await showCatalog([CHANGED]);
  const correction = `/metadata/corrections/${encodeURIComponent(CHANGED.id)}`;
  api.reply(
    correction,
    {
      ...ALIEN,
      metadata: {
        ...ALIEN.metadata,
        title: "Aliens",
        correctedFields: ["title"],
      },
    },
    "PATCH",
  );

  const form = openCorrection("Alien (1979)");
  type(form, "Title", "Aliens");
  fireEvent.click(form.getByRole("button", { name: "Save" }));

  const details = within(
    await screen.findByRole("dialog", { name: "Media details" }),
  );
  expect(details.queryByText("File changed since it was matched")).toBeNull();
  expect(api.requestsTo(correction)).toMatchObject([
    { method: "PATCH", body: { title: "Aliens" } },
  ]);
});

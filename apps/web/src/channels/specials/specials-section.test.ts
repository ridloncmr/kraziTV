// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { Special, SpecialPreview } from "./contracts.js";
import { adminFixtures } from "../../testing/admin-fixtures.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { SpecialsSection } from "./specials-section.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LIST = "/channels/one/reservations";
const PREVIEW = `${LIST}/preview`;
// Far enough ahead that the special has not started.
const START_LOCAL = "2099-06-01T20:00";
const START = new Date(START_LOCAL).toISOString();
const END = new Date("2099-06-01T21:30").toISOString();

// A preview that saving these settings would publish as shown.
const planned = (overrides: Partial<SpecialPreview> = {}): SpecialPreview => ({
  scheduleRevision: 7,
  conflicts: [],
  startsAt: START,
  endsAt: END,
  endKind: "program_derived",
  beyondHorizon: false,
  programs: [
    {
      mediaItemId: "z",
      title: "Alpha",
      startsAt: START,
      endsAt: END,
      estimated: false,
    },
  ],
  fillerBefore: null,
  fillerInside: null,
  deferredProgram: null,
  resumesWith: { mediaItemId: "a", title: "Zulu", startsAt: END },
  ...overrides,
});

const saved: Special = {
  id: "special-1",
  channelId: "one",
  startsAt: START,
  endsAt: END,
  endKind: "program_derived",
  interrupts: false,
  source: { kind: "media_items", mediaItemIds: ["z"] },
};

// The section over a channel with `specials`, the fixture catalog, and its one collection.
function renderSection(specials: Special[] = []) {
  const api = new BrowserApi();
  api.reply(LIST, specials);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/media-items", { items: adminFixtures.media, total: 2 });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(SpecialsSection, { channelId: "one", visible: true }));
  return api;
}

// Opens a new special and sets its start.
async function startNewSpecial() {
  fireEvent.click(await screen.findByRole("button", { name: "Add a special" }));
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: START_LOCAL },
  });
}

// The body of the last request sent to `path` with `method`.
function lastBody(api: BrowserApi, path: string, method: string) {
  return api
    .requestsTo(path)
    .filter((request) => request.method === method)
    .at(-1)?.body as Record<string, unknown> | undefined;
}

it("previews media items in order and saves exactly what was previewed", async () => {
  const api = renderSection();
  await startNewSpecial();
  await screen.findByRole("option", { name: "Alpha (available)" });
  fireEvent.change(screen.getByLabelText("Program 1"), {
    target: { value: "z" },
  });
  api.reply(PREVIEW, planned(), "POST");

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  const preview = await screen.findByRole("region", {
    name: "Special preview",
  });
  expect(within(preview).getByText(/Alpha/)).toBeTruthy();
  expect(within(preview).getByText(/resumes with Zulu/)).toBeTruthy();
  expect(lastBody(api, PREVIEW, "POST")).toEqual({
    startsAt: START,
    endsAt: null,
    interrupts: false,
    source: { kind: "media_items", mediaItemIds: ["z"] },
  });
  api.reply(LIST, saved, "POST", 201);
  fireEvent.click(screen.getByRole("button", { name: "Save special" }));
  await waitFor(() => expect(lastBody(api, LIST, "POST")).toBeDefined());
  expect(lastBody(api, LIST, "POST")).toEqual({
    startsAt: START,
    endsAt: null,
    interrupts: false,
    source: { kind: "media_items", mediaItemIds: ["z"] },
    expectedScheduleRevision: 7,
    requestKey: expect.any(String),
  });
});

it("saves a collection block with its explicit end", async () => {
  const api = renderSection();
  await startNewSpecial();
  fireEvent.change(screen.getByLabelText("What airs"), {
    target: { value: "collection" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2099-06-01T21:30" },
  });
  await screen.findByRole("option", { name: "Favorites" });
  fireEvent.change(screen.getByLabelText("Collection"), {
    target: { value: "favorites" },
  });
  api.reply(PREVIEW, planned({ endKind: "explicit" }), "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Special preview" });
  api.reply(LIST, saved, "POST", 201);

  fireEvent.click(screen.getByRole("button", { name: "Save special" }));

  await waitFor(() =>
    expect(lastBody(api, LIST, "POST")).toMatchObject({
      endsAt: END,
      source: {
        kind: "collection",
        mediaCollectionId: "favorites",
        playbackMode: "chronological",
      },
    }),
  );
});

it("previews a collection from the beginning without random and saves the list it resolves to", async () => {
  const api = renderSection();
  await startNewSpecial();
  fireEvent.change(screen.getByLabelText("What airs"), {
    target: { value: "collection_from_beginning" },
  });
  await screen.findByRole("option", { name: "Favorites" });
  fireEvent.change(screen.getByLabelText("Collection"), {
    target: { value: "favorites" },
  });
  fireEvent.change(screen.getByLabelText("Playback mode"), {
    target: { value: "release" },
  });
  expect(screen.queryByRole("option", { name: "Random" })).toBeNull();
  api.reply(PREVIEW, planned({ mediaItemIds: ["a", "z"] }), "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Special preview" });
  api.reply(LIST, saved, "POST", 201);

  fireEvent.click(screen.getByRole("button", { name: "Save special" }));

  expect(lastBody(api, PREVIEW, "POST")).toMatchObject({
    source: {
      kind: "collection_from_beginning",
      mediaCollectionId: "favorites",
      playbackMode: "release",
    },
  });
  await waitFor(() =>
    expect(lastBody(api, LIST, "POST")).toMatchObject({
      source: { kind: "media_items", mediaItemIds: ["a", "z"] },
    }),
  );
});

it("asks for a fresh preview when the schedule changed since the preview", async () => {
  const api = renderSection();
  await startNewSpecial();
  api.reply(PREVIEW, planned(), "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Special preview" });
  api.reply(
    LIST,
    { error: { code: "preview_stale", message: "The schedule changed" } },
    "POST",
    409,
  );

  fireEvent.click(screen.getByRole("button", { name: "Save special" }));

  await screen.findByText(/Preview again before saving/);
  expect(screen.queryByRole("region", { name: "Special preview" })).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save special" })
      .disabled,
  ).toBe(true);
});

it("shows a start more than a year ahead as a conflict and offers no save", async () => {
  const api = renderSection();
  await startNewSpecial();
  api.reply(
    PREVIEW,
    {
      scheduleRevision: 7,
      commitment: "exact",
      conflicts: [
        {
          code: "reservation_too_far",
          message: "A special can start at most a year ahead",
        },
      ],
    },
    "POST",
  );

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  const conflicts = await screen.findByRole("alert", {
    name: "Special conflicts",
  });
  expect(within(conflicts).getByText(/at most a year ahead/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save special" })
      .disabled,
  ).toBe(true);
});

it("edits and cancels a special before it starts, and only then", async () => {
  const started: Special = {
    ...saved,
    id: "special-0",
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2020-01-01T01:00:00.000Z",
  };
  const api = renderSection([started, saved]);
  const [startedRow, laterRow] = await screen.findAllByRole("listitem");
  if (startedRow === undefined || laterRow === undefined) {
    throw new Error("Both specials should be listed");
  }
  expect(within(startedRow).queryByRole("button", { name: "Edit" })).toBeNull();

  fireEvent.click(within(laterRow).getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText<HTMLInputElement>("Starts").value).toBe(
    START_LOCAL,
  );
  api.reply(PREVIEW, planned({ scheduleRevision: 9 }), "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Special preview" });
  api.reply(`${LIST}/special-1`, saved, "PATCH");
  fireEvent.click(screen.getByRole("button", { name: "Save special" }));
  await waitFor(() =>
    expect(lastBody(api, `${LIST}/special-1`, "PATCH")).toEqual({
      startsAt: START,
      endsAt: null,
      interrupts: false,
      source: { kind: "media_items", mediaItemIds: ["z"] },
      expectedScheduleRevision: 9,
    }),
  );
  // The edit's preview leaves the special it replaces out.
  expect(lastBody(api, PREVIEW, "POST")).toMatchObject({
    replacesReservationId: "special-1",
  });

  api.reply(`${LIST}/special-1`, undefined, "DELETE", 204);
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel special" }),
  );
  await waitFor(() =>
    expect(
      api
        .requestsTo(`${LIST}/special-1`)
        .some((request) => request.method === "DELETE"),
    ).toBe(true),
  );
});

it("drops a preview that answers after an edit, so it never pairs with other settings", async () => {
  const api = renderSection();
  await startNewSpecial();
  api.hold(PREVIEW, "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2099-06-02T20:00" },
  });

  api.release(PREVIEW, planned(), "POST");

  await waitFor(() => expect(api.requestsTo(PREVIEW)).toHaveLength(1));
  expect(screen.queryByRole("region", { name: "Special preview" })).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save special" })
      .disabled,
  ).toBe(true);
});

it("clears a stale save's message once a fresh preview arrives, and saves it under a new key", async () => {
  const api = renderSection();
  await startNewSpecial();
  api.reply(PREVIEW, planned(), "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Special preview" });
  api.reply(
    LIST,
    { error: { code: "preview_stale", message: "The schedule changed" } },
    "POST",
    409,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save special" }));
  await screen.findByText(/Preview again before saving/);
  const firstKey = lastBody(api, LIST, "POST")?.requestKey;

  api.reply(PREVIEW, planned({ scheduleRevision: 8 }), "POST");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("region", { name: "Special preview" });

  expect(screen.queryByText(/Preview again before saving/)).toBeNull();
  expect(screen.queryByText("The schedule changed")).toBeNull();
  api.reply(LIST, saved, "POST", 201);
  fireEvent.click(screen.getByRole("button", { name: "Save special" }));
  await waitFor(() =>
    expect(lastBody(api, LIST, "POST")?.expectedScheduleRevision).toBe(8),
  );
  expect(lastBody(api, LIST, "POST")?.requestKey).not.toBe(firstKey);
});

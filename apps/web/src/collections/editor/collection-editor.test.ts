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
import { BrowserApi } from "../../testing/browser-api.js";
import { adminFixtures } from "../../testing/admin-fixtures.js";
import {
  catalogSeries,
  episodes,
  officeCollection,
  serveCollection,
} from "../../testing/collection-api.js";
import { CollectionEditor } from "./collection-editor.js";
import { clickWhenEnabled } from "../../testing/click-when-enabled.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Serves a collection, favorites by default, with the given saved order and renders its editor.
function renderEditor(
  memberIds: string[],
  collection = adminFixtures.collections[0],
) {
  const api = new BrowserApi();
  serveCollection(api, collection.id, memberIds);
  vi.stubGlobal("fetch", api.fetch);
  const onDirtyChange = vi.fn();
  render(
    createElement(CollectionEditor, {
      collection,
      visible: true,
      changed: vi.fn(),
      deleted: vi.fn(),
      onDirtyChange,
    }),
  );
  return { api, onDirtyChange };
}

// Reads the draft order from the member checkboxes, which render in position order.
function memberOrder() {
  return screen
    .getAllByLabelText(/^Select member /)
    .map((box) =>
      box.getAttribute("aria-label")?.replace("Select member ", ""),
    );
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function lastPut(api: BrowserApi) {
  return api.requests.filter((request) => request.method === "PUT").at(-1)
    ?.body;
}

it("adds picked catalog media in path order, moves a chosen block and saves the whole order", async () => {
  const { api, onDirtyChange } = renderEditor(["z", "a"]);
  await screen.findByText(/Schedulable · 1 eligible/);
  fireEvent.click(await screen.findByLabelText("Select Episode 10"));
  fireEvent.click(screen.getByLabelText("Select Episode 2"));
  expect(screen.queryByLabelText("Select Alpha")).toBeNull();
  click("Add selected (2)");
  expect(memberOrder()).toEqual(["Alpha", "Zulu", "Episode 2", "Episode 10"]);
  expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);

  fireEvent.click(screen.getByLabelText("Select member Episode 2"));
  fireEvent.click(screen.getByLabelText("Select member Zulu"));
  click("Move to top");
  expect(memberOrder()).toEqual(["Zulu", "Episode 2", "Alpha", "Episode 10"]);
  click("Save changes");

  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(lastPut(api)).toEqual({ mediaItemIds: ["a", "e2", "z", "e10"] });
  await screen.findByText(/eligible of 4 saved members/);
  expect(memberOrder()).toEqual(["Zulu", "Episode 2", "Alpha", "Episode 10"]);
});

it("adds every match of the settled search and refuses a capped match list", async () => {
  const { api } = renderEditor(["z"]);
  await screen.findByLabelText("Select Episode 2");
  fireEvent.change(screen.getByLabelText("Find media"), {
    target: { value: "show" },
  });
  await waitFor(() =>
    expect(
      api.requests.some(
        (request) => (request.body as { q?: string } | undefined)?.q === "show",
      ),
    ).toBe(true),
  );
  api.reply("/media-items/matches", { items: episodes, total: 2 }, "POST");
  click("Add all (3)");

  await waitFor(() =>
    expect(memberOrder()).toEqual(["Alpha", "Episode 2", "Episode 10"]),
  );
  expect(
    api.requests.find((request) => request.path === "/media-items/matches")
      ?.body,
  ).toEqual({ q: "show", excludeIds: ["z"] });

  api.reply(
    "/media-items/matches",
    { items: [episodes[0]], total: 5001 },
    "POST",
  );
  await waitFor(() => click("Add all (1)"));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /5001 items match/,
  );
  expect(memberOrder()).toEqual(["Alpha", "Episode 2", "Episode 10"]);
});

it("keeps member edits made while an add-all request is pending", async () => {
  const { api } = renderEditor(["z", "a"]);
  await screen.findByText("Add all (2)");
  api.hold("/media-items/matches", "POST");
  click("Add all (2)");
  fireEvent.click(screen.getByLabelText("Select member Zulu"));
  click("Move to top");

  api.release("/media-items/matches", { items: episodes, total: 2 }, "POST");

  await waitFor(() =>
    expect(memberOrder()).toEqual(["Zulu", "Alpha", "Episode 2", "Episode 10"]),
  );
});

it("hides draft members from the catalog and clears an offset left past the last page", async () => {
  const { api } = renderEditor(["z", "a"]);
  await screen.findByText("Add all (2)");
  expect(screen.queryByLabelText("Select Alpha")).toBeNull();

  fireEvent.click(screen.getByLabelText("Select this page"));
  click("Add selected (2)");

  await screen.findByText(
    "Every cataloged item is already in this collection.",
  );
  expect(
    api.requests
      .filter((request) => request.path === "/media-items/search")
      .at(-1)?.body,
  ).toMatchObject({ excludeIds: ["a", "e10", "e2", "z"], offset: 0 });
});

it("toggles catalog and member rows from anywhere on the row except its buttons", async () => {
  renderEditor(["z", "a"]);
  const box = (label: string) =>
    screen.getByLabelText<HTMLInputElement>(label).checked;

  fireEvent.click(await screen.findByText("Episode 2"));
  expect(box("Select Episode 2")).toBe(true);
  fireEvent.click(screen.getByText("Episode 2"));
  expect(box("Select Episode 2")).toBe(false);
  fireEvent.click(screen.getByText("Episode 10"));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Add from catalog" })).getByRole(
      "button",
      { name: "Clear selection" },
    ),
  );
  expect(box("Select Episode 10")).toBe(false);

  fireEvent.click(screen.getByText("Zulu"));
  expect(box("Select member Zulu")).toBe(true);
  click("Move Zulu up");
  expect(memberOrder()).toEqual(["Zulu", "Alpha"]);
  expect(box("Select member Zulu")).toBe(true);
  expect(box("Select member Alpha")).toBe(false);

  click("Remove selected (1)");
  expect(memberOrder()).toEqual(["Alpha"]);
});

it("shift-clicks a catalog range from rows or checkboxes to the clicked row's new state", async () => {
  renderEditor([]);
  const box = (label: string) =>
    screen.getByLabelText<HTMLInputElement>(label).checked;

  fireEvent.click(await screen.findByText("Alpha"));
  fireEvent.click(screen.getByText("Episode 10"), { shiftKey: true });
  expect(
    ["Alpha", "Zulu", "Episode 10", "Episode 2"].map((title) =>
      box(`Select ${title}`),
    ),
  ).toEqual([true, true, true, false]);

  fireEvent.click(screen.getByLabelText("Select Zulu"), { shiftKey: true });
  expect(
    ["Alpha", "Zulu", "Episode 10", "Episode 2"].map((title) =>
      box(`Select ${title}`),
    ),
  ).toEqual([true, false, false, false]);
});

it("shift-clicks a member range through the filtered order only", async () => {
  renderEditor(["e10", "z", "a", "e2"]);
  await screen.findByLabelText("Select member Zulu");
  fireEvent.change(screen.getByLabelText("Filter members"), {
    target: { value: "episode" },
  });

  fireEvent.click(screen.getByText("Episode 10"));
  fireEvent.click(screen.getByText("Episode 2"), { shiftKey: true });
  fireEvent.change(screen.getByLabelText("Filter members"), {
    target: { value: "" },
  });
  expect(
    screen.getByRole("button", { name: "Remove selected (2)" }),
  ).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("Select member Alpha").checked,
  ).toBe(false);
});

it("removes every member the filter shows and keeps choices it hides", async () => {
  renderEditor(["e10", "z", "a", "e2"]);
  fireEvent.click(await screen.findByLabelText("Select member Zulu"));
  fireEvent.change(screen.getByLabelText("Filter members"), {
    target: { value: "episode" },
  });

  click("Remove all (2)");
  expect(screen.getByText("No members match this filter.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Filter members"), {
    target: { value: "" },
  });
  expect(memberOrder()).toEqual(["Alpha", "Zulu"]);
  click("Remove selected (1)");
  expect(memberOrder()).toEqual(["Alpha"]);
});

it("filters without renumbering, moves to a position, sorts and discards back to the saved order", async () => {
  renderEditor(["e10", "z", "a", "e2"]);
  await screen.findByLabelText("Select member Zulu");

  fireEvent.change(screen.getByLabelText("Filter members"), {
    target: { value: "episode" },
  });
  expect(memberOrder()).toEqual(["Episode 10", "Episode 2"]);
  fireEvent.click(screen.getByLabelText("Select all shown members"));
  fireEvent.change(screen.getByLabelText("Filter members"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("Target position"), {
    target: { value: "2" },
  });
  click("Move to position");
  expect(memberOrder()).toEqual(["Alpha", "Episode 10", "Episode 2", "Zulu"]);

  click("Sort all by path");
  expect(memberOrder()).toEqual(["Alpha", "Zulu", "Episode 2", "Episode 10"]);

  click("Discard changes");
  expect(memberOrder()).toEqual(["Episode 10", "Alpha", "Zulu", "Episode 2"]);
  expect(screen.queryByText(/Unsaved changes/)).toBeNull();
});

it("labels a missing member as not airing until its file returns, with an icon beside the text", async () => {
  renderEditor(["z", "a"]);

  const zulu = (await screen.findByLabelText("Select member Zulu")).closest(
    "tr",
  )!;
  const alpha = screen.getByLabelText("Select member Alpha").closest("tr")!;

  expect(
    within(zulu).getByText("Missing — won't air until the file returns"),
  ).toBeTruthy();
  expect(within(zulu).getByRole("img", { name: "Warning" })).toBeTruthy();
  expect(within(alpha).queryByText(/Missing/)).toBeNull();
});

it("explains incomplete maintenance in the automatic editor", async () => {
  renderEditor(["e2", "e10"], {
    ...officeCollection,
    maintenanceIncomplete: true,
  });

  expect(
    await screen.findByText(
      /Some media's TMDB data expired, so their membership could not be checked/,
    ),
  ).toBeTruthy();
});

it("reports why an automatic collection's latest maintenance failed", async () => {
  renderEditor(["e2", "e10"], {
    ...officeCollection,
    maintenanceError: "disk I/O error",
  });

  expect((await screen.findByRole("alert")).textContent).toMatch(
    /Updating this collection failed: disk I\/O error\. Its members are as of /,
  );
});

it("shows an automatic collection's criterion and members read-only while allowing rename and delete", async () => {
  renderEditor(["e2", "e10"], officeCollection);

  await screen.findByText("Episode 10");

  expect(screen.getByText("TV series: The Office")).toBeTruthy();
  expect(screen.getByText(/^Last updated /)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(screen.queryByLabelText(/^Select member /)).toBeNull();
  expect(screen.queryByLabelText("Find media")).toBeNull();
  expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Delete collection" }),
  ).toBeTruthy();
});

it("excludes a member, lists excluded items labelled with whether they still qualify, and restores one", async () => {
  const { api } = renderEditor(["e2", "e10"], officeCollection);
  const exclusions = "/media-collections/office/exclusions";
  api.reply(`${exclusions}/e2`, null, "PUT", 204);
  api.reply(`${exclusions}/z`, null, "DELETE", 204);
  api.reply(exclusions, [
    {
      mediaItemId: "z",
      title: "Alpha",
      path: "/media/alpha.mp4",
      status: "available",
      durationMs: 1_200_000,
      qualifies: false,
    },
  ]);
  await screen.findByText("Episode 10");

  click("Exclude Episode 2 from this collection");
  await waitFor(() =>
    expect(api.requestsTo(`${exclusions}/e2`)[0]?.method).toBe("PUT"),
  );
  fireEvent.click(screen.getByLabelText("Show excluded"));

  const excluded = await screen.findByRole("table", { name: "Excluded media" });
  const row = within(excluded).getByText("Alpha").closest("tr")!;
  expect(within(row).getByText("Excluded")).toBeTruthy();
  expect(within(row).getByText("No longer matches")).toBeTruthy();
  fireEvent.click(
    within(row).getByRole("button", { name: "Restore inclusion of Alpha" }),
  );
  await waitFor(() =>
    expect(api.requestsTo(`${exclusions}/z`)[0]?.method).toBe("DELETE"),
  );
});

it("points to conversion for edits and converts an automatic collection to manual after confirmation", async () => {
  const { api } = renderEditor(["e2", "e10"], officeCollection);
  const conversion = "/media-collections/office/conversion";
  api.reply(
    conversion,
    {
      id: "office",
      name: "The Office",
      maintenanceMode: "manual",
      criterion: null,
      criterionLabel: null,
      maintainedAt: null,
      maintenanceError: null,
      maintenanceIncomplete: null,
    },
    "POST",
  );
  await screen.findByText("Episode 10");
  expect(
    screen.getByText(
      /To add media or change the order, convert this collection to manual/,
    ),
  ).toBeTruthy();

  click("Convert to manual…");
  const dialog = screen.getByRole("dialog", { name: "Convert to manual" });
  expect(api.requestsTo(conversion)).toHaveLength(0);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Convert to manual collection",
    }),
  );

  await waitFor(() => expect(api.requestsTo(conversion)).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("changes an automatic collection's criterion after previewing it with the collection's exclusions", async () => {
  const { api } = renderEditor(["e2", "e10"], officeCollection);
  api.reply("/media-collections/series", catalogSeries);
  api.reply(
    "/media-collections/previews",
    [
      {
        position: 0,
        mediaItemId: "z",
        title: "Alpha",
        path: "/media/alpha.mp4",
        status: "available",
        durationMs: 1_200_000,
      },
    ],
    "POST",
  );
  api.reply("/media-collections/office", officeCollection, "PATCH");
  await screen.findByText("Episode 10");

  click("Change criterion…");
  const dialog = screen.getByRole("dialog", { name: "Change criterion" });
  await within(dialog).findByRole("option", { name: /^The Office/ });
  fireEvent.change(within(dialog).getByLabelText("Series"), {
    target: { value: "8592" },
  });
  await within(dialog).findByText("1 episode in this order");
  await clickWhenEnabled(
    within(dialog).getByRole("button", { name: "Apply criterion" }),
  );

  await waitFor(() =>
    expect(
      api.requests.find((request) => request.method === "PATCH")?.body,
    ).toEqual({ criterion: { kind: "series", tmdbId: 8592 } }),
  );
  expect(api.requestsTo("/media-collections/previews").at(-1)?.body).toEqual({
    criterion: { kind: "series", tmdbId: 8592 },
    mediaCollectionId: "office",
  });
});

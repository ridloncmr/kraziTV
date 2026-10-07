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
import { BrowserApi } from "../testing/browser-api.js";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { episodes, serveCollection } from "../testing/collection-api.js";
import { CollectionEditor } from "./collection-editor.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Serves the favorites collection with the given saved order and renders its editor.
function renderEditor(memberIds: string[]) {
  const api = new BrowserApi();
  serveCollection(api, "favorites", memberIds);
  vi.stubGlobal("fetch", api.fetch);
  const onDirtyChange = vi.fn();
  render(
    createElement(CollectionEditor, {
      collection: adminFixtures.collections[0],
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

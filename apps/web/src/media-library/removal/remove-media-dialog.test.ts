// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { displayClockTime } from "../../controls/display-time.js";
import type {
  CatalogRemoval,
  CatalogRemovalImpact,
} from "../../http/contracts.js";
import { adminFixtures } from "../../testing/admin-fixtures.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { mediaRoot } from "../../testing/scan-fixtures.js";
import { MediaLibraryApp } from "../media-library-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PREVIEW = "/catalog-removals/preview";
const REMOVE = "/catalog-removals";
const ENDS_AT = "2026-10-07T21:30:00.000Z";

/** A preview with nothing on air and no channel left unschedulable. */
function impact(
  overrides: Partial<CatalogRemovalImpact> = {},
): CatalogRemovalImpact {
  return {
    itemCount: 1,
    airing: [],
    channelsLeftUnschedulable: [],
    affectedChannelIds: [],
    ...overrides,
  };
}

/** Channel 69 airing "Alpha" until ENDS_AT. */
const AIRING_ENTRY = {
  channelId: "one",
  channelNumber: "69",
  mediaItemId: "z",
  title: "Alpha",
  endsAt: ENDS_AT,
};
const AIRING = impact({
  airing: [AIRING_ENTRY],
  affectedChannelIds: ["one"],
});

/** A removal result that touched nothing on air. */
function removal(overrides: Partial<CatalogRemoval> = {}): CatalogRemoval {
  return {
    removedItemCount: 1,
    finishing: [],
    interruptedChannelIds: [],
    stopFailedChannelIds: [],
    affectedChannelIds: [],
    ...overrides,
  };
}

/** The Delete… button of the one root's row. */
async function rootDelete() {
  const roots = await screen.findByRole("group", { name: "Media roots" });
  return within(roots).findByRole("button", { name: "Delete…" });
}

/** The Delete… button that removes the selected catalog rows. */
function selectionDelete() {
  return within(
    screen.getByRole("group", { name: "Selected media" }),
  ).getByRole<HTMLButtonElement>("button", { name: "Delete…" });
}

/** Waits for the catalog's Delete… button to render, then returns it. */
async function findSelectionDelete() {
  await screen.findByRole("group", { name: "Selected media" });
  return selectionDelete();
}

/** The Media Library over one root and the two fixture items. */
function renderLibrary() {
  const api = new BrowserApi();
  api.reply("/media-roots", [mediaRoot()]);
  api.reply("/media-items", { items: adminFixtures.media, total: 2 });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  return api;
}

/** Selects the "Alpha" row and opens the Delete media dialog. */
async function openItemRemoval(api: BrowserApi, preview: unknown) {
  api.reply(PREVIEW, preview, "POST");
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Select Alpha" }),
  );
  fireEvent.click(selectionDelete());
  const dialog = screen.getByRole("dialog", { name: "Delete media" });
  await within(dialog).findByText(/will be deleted from the catalog/);
  return dialog;
}

it("clears the catalog selection, leaving nothing to remove", async () => {
  renderLibrary();
  const clear = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Clear selection",
  });
  expect(clear.disabled).toBe(true);

  fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Zulu" }));
  expect(clear.disabled).toBe(false);
  fireEvent.click(clear);

  for (const title of ["Alpha", "Zulu"]) {
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: `Select ${title}`,
      }).checked,
    ).toBe(false);
  }
  expect(clear.disabled).toBe(true);
  expect(selectionDelete().disabled).toBe(true);
});

it("keeps Delete… disabled until a row is selected, and previews the selection", async () => {
  const api = renderLibrary();
  const remove = await findSelectionDelete();
  expect(remove.disabled).toBe(true);
  api.hold(PREVIEW, "POST");

  fireEvent.click(screen.getByText("Zulu"));
  fireEvent.click(remove);
  const dialog = screen.getByRole("dialog", { name: "Delete media" });

  expect(within(dialog).getByRole("status").textContent).toBe("Checking…");
  await act(async () => api.release(PREVIEW, impact(), "POST"));
  expect(
    within(dialog).getByText(
      "1 selected media item will be deleted from the catalog.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByText("Files on disk are not touched."),
  ).toBeTruthy();
  expect(
    within(dialog).getByText("Collections lose these items."),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "Items whose files still exist return on the next scan of their root.",
    ),
  ).toBeTruthy();
  expect(within(dialog).queryByText("Now airing")).toBeNull();
  expect(
    api.requests.find((request) => request.path === PREVIEW)?.body,
  ).toEqual({ target: { mediaItemIds: ["a"] } });
});

it("previews a root removal with its path and item count", async () => {
  const api = renderLibrary();
  api.reply(PREVIEW, impact({ itemCount: 1204 }), "POST");

  fireEvent.click(await rootDelete());
  const dialog = screen.getByRole("dialog", { name: "Delete media root" });

  await within(dialog).findByText(
    "/media and its 1,204 media items will be deleted from the catalog.",
  );
  expect(within(dialog).queryByText(/return on the next scan/)).toBeNull();
  expect(
    api.requests.find((request) => request.path === PREVIEW)?.body,
  ).toEqual({ target: { mediaRootId: "root" } });
});

it("offers the airing choice, letting the program finish by default", async () => {
  const api = renderLibrary();
  const dialog = await openItemRemoval(api, AIRING);

  expect(within(dialog).getByText("Now airing")).toBeTruthy();
  expect(
    within(dialog).getByText(`69: Alpha, until ${displayClockTime(ENDS_AT)}`),
  ).toBeTruthy();
  const finish = within(dialog).getByRole("radio", { name: /Let it finish/ });
  const interrupt = within(dialog).getByRole("radio", {
    name: /Stop it now and rebuild the schedule/,
  });
  expect((finish as HTMLInputElement).checked).toBe(true);
  expect(
    within(dialog).getByText(
      "The program plays to its scheduled end. The channel's schedule changes after it.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "The channel's schedule is rebuilt from now. Anyone watching these channels is disconnected and must tune in again to see the new program.",
    ),
  ).toBeTruthy();

  api.hold(REMOVE, "POST");
  fireEvent.click(interrupt);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(
      api.requests.find((request) => request.path === REMOVE)?.body,
    ).toEqual({
      target: { mediaItemIds: ["z"] },
      airing: "interrupt",
      allowUnschedulable: false,
    }),
  );
});

it("warns about channels left with nothing to play and asks to remove anyway", async () => {
  const api = renderLibrary();
  const dialog = await openItemRemoval(api, {
    ...AIRING,
    channelsLeftUnschedulable: [
      { channelId: "one", channelNumber: "69" },
      { channelId: "two", channelNumber: "70" },
    ],
  });

  expect(
    within(dialog).getByText("Channels left with nothing to play"),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "Channel 69 goes off air after its current program.",
    ),
  ).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("radio", { name: /Stop it now/ }));
  // Only a channel airing removed media is stopped now; others finish first.
  expect(
    within(dialog).getByText("Channel 69 goes off air right away."),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "Channel 70 goes off air after its current program.",
    ),
  ).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
  expect(
    within(dialog).getByRole("button", { name: "Delete anyway" }),
  ).toBeTruthy();
});

it.each([
  [
    "scan_in_progress",
    {},
    "This media root is being scanned. Cancel the scan or wait for it to finish.",
  ],
  [
    "media_item_not_found",
    {},
    "Some of the selected media is no longer in the catalog. Refresh and try again.",
  ],
  [
    "media_item_in_use",
    { channelIds: ["two", "one"], mediaItemIds: ["z"] },
    "Channels 70, 69 play an item from this media root directly. Change those blocks first.",
  ],
])(
  "shows a %s refusal in place of the preview with only Close",
  async (code, details, message) => {
    const api = renderLibrary();
    api.reply("/channels", adminFixtures.channels);
    api.reply(
      PREVIEW,
      { error: { code, message: "server text", ...details } },
      "POST",
      409,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select Alpha" }),
    );
    fireEvent.click(selectionDelete());
    const dialog = screen.getByRole("dialog", { name: "Delete media" });

    await within(dialog).findByText(message);
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["×", "Close"]);
  },
);

it("names a single channel playing an item directly", async () => {
  const api = renderLibrary();
  api.reply("/channels", adminFixtures.channels);
  api.reply(
    PREVIEW,
    {
      error: {
        code: "media_item_in_use",
        message: "server text",
        channelIds: ["one"],
        mediaItemIds: ["z"],
      },
    },
    "POST",
    409,
  );
  fireEvent.click(await rootDelete());

  await screen.findByText(
    "Channel 69 plays an item from this media root directly. Change that block first.",
  );
});

it("shows a changed impact and asks again when the removal finds new channels left unschedulable", async () => {
  const api = renderLibrary();
  const dialog = await openItemRemoval(api, impact());
  api.reply(
    REMOVE,
    {
      error: {
        code: "channels_left_unschedulable",
        message: "server text",
        impact: impact({
          channelsLeftUnschedulable: [
            { channelId: "two", channelNumber: "70" },
          ],
        }),
      },
    },
    "POST",
    409,
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  await within(dialog).findByText(
    "Channel 70 goes off air after its current program.",
  );
  api.reply(REMOVE, removal(), "POST");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete anyway" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    api.requests.filter((request) => request.path === REMOVE).at(-1)?.body,
  ).toMatchObject({ allowUnschedulable: true });
});

it("closes on success, reports finishing channels, and clears the selection", async () => {
  const api = renderLibrary();
  const dialog = await openItemRemoval(api, AIRING);
  api.reply(
    REMOVE,
    removal({ finishing: [{ channelId: "one", endsAt: ENDS_AT }] }),
    "POST",
  );
  const reads = api.requests.length;

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  await screen.findByText(
    "Deleted 1 media item. Channel 69 finishes its current program first.",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Select Alpha" })
      .checked,
  ).toBe(false);
  expect(selectionDelete().disabled).toBe(true);
  const refreshed = api.requests.slice(reads).map((request) => request.path);
  expect(refreshed).toEqual(
    expect.arrayContaining(["/media-roots", "/media-items"]),
  );
});

it("reports a root removal that restarted one channel and could not stop another", async () => {
  const api = renderLibrary();
  api.reply(
    PREVIEW,
    impact({
      itemCount: 1204,
      airing: [
        AIRING_ENTRY,
        { ...AIRING_ENTRY, channelId: "two", channelNumber: "70" },
      ],
    }),
    "POST",
  );
  api.reply(
    REMOVE,
    removal({
      removedItemCount: 1204,
      interruptedChannelIds: ["one", "two"],
      stopFailedChannelIds: ["two"],
    }),
    "POST",
  );
  fireEvent.click(await rootDelete());
  const dialog = screen.getByRole("dialog", { name: "Delete media root" });
  fireEvent.click(
    await within(dialog).findByRole("radio", { name: /Stop it now/ }),
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  await screen.findByText(
    "Deleted /media and 1,204 media items. Channel 69 restarted on its new schedule. Channel 70 could not be stopped; it switches at the end of its current program.",
  );
});

it("keeps the selection and the dialog after a refused removal", async () => {
  const api = renderLibrary();
  const dialog = await openItemRemoval(api, impact());
  api.reply(
    REMOVE,
    { error: { code: "scan_in_progress", message: "server text" } },
    "POST",
    409,
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await within(dialog).findByText(
    "This media root is being scanned. Cancel the scan or wait for it to finish.",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Select Alpha" })
      .checked,
  ).toBe(true);
});

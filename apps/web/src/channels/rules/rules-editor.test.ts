// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../../testing/browser-api.js";
import {
  adminFixtures,
  collectionWith,
  ruleFixture,
} from "../../testing/admin-fixtures.js";
import { openChannelTab } from "../../testing/channel-tabs.js";
import { chooseOption, chosenOption } from "../../testing/choose-option.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RULES = "/channels/one/programming-rules";

// A saved assignment of one collection, as the server lists it.
function assignment(
  id: string,
  collectionId: string,
  participation: "default" | "rule_only" = "default",
) {
  return {
    id,
    name: null,
    participation,
    playbackMode: "chronological",
    ordinaryStretch: { kind: "programs", count: 1 },
    marathonStretch: { kind: "programs", count: 3 },
    members: [{ kind: "collection", mediaCollectionId: collectionId }],
  };
}

// The rebuild question a rule edit asks while the fixture program airs.
const REBUILD = "What should happen to Alpha?";

// The editor over Favorites in rotation and rule-only Christmas Movies,
// while the fixture program Alpha airs unless `now` says otherwise.
function editorApi(rules: unknown[] = [], now: unknown = adminFixtures.now) {
  const api = new BrowserApi();
  api.reply("/channels/one/now", now);
  api.reply("/channels/one/programming-assignments", [
    assignment("favorites-turns", "favorites"),
    assignment("christmas-turns", "christmas", "rule_only"),
  ]);
  api.reply("/media-collections", [
    ...adminFixtures.collections,
    collectionWith("christmas", "Christmas Movies"),
  ]);
  api.reply("/programming-timezone", {
    programmingTimezone: "America/New_York",
  });
  api.reply(RULES, rules);
  // Christmas Movies holds movies; Favorites holds episodes.
  api.handle("/programming-assignments/stretch-suggestion", (request) =>
    api.response({
      ordinaryStretch: null,
      contentKind:
        request.query.get("mediaCollectionIds") === "christmas"
          ? "movies"
          : "episodes",
    }),
  );
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 1,
    turns: [],
    skips: [],
  });
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

// Opens the Rules tab's New rule dialog.
async function openNewRule(api: BrowserApi) {
  await openChannelTab(api, "Rules");
  fireEvent.click(await screen.findByRole("button", { name: "New rule…" }));
  return screen.getByRole("dialog", { name: "New rule" });
}

// Switches the rule dialog to one of its tabs.
function showTab(form: HTMLElement, tab: "General" | "When" | "What plays") {
  fireEvent.click(within(form).getByRole("tab", { name: tab }));
}

// Opens one rule's row menu and chooses a command from it.
function chooseRowCommand(rule: string, command: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${rule}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: command }));
}

it("shows the timezone rules follow, and saves a December join rule, letting the airing program finish", async () => {
  const api = editorApi();
  api.reply(RULES, ruleFixture("december", "December", []), "POST");

  const form = await openNewRule(api);
  fireEvent.change(within(form).getByLabelText("Name"), {
    target: { value: "December" },
  });
  chooseOption(within(form).getByLabelText("Priority"), "1 (lowest)");
  showTab(form, "When");
  expect(
    (await within(form).findByText(/America\/New_York/)).textContent,
  ).toMatch(/follow the server's programming timezone, America\/New_York/);
  fireEvent.change(within(form).getByLabelText("Dates"), {
    target: { value: "annual" },
  });
  fireEvent.change(within(form).getByLabelText("From"), {
    target: { value: "12-01" },
  });
  fireEvent.change(within(form).getByLabelText("Through"), {
    target: { value: "12-31" },
  });
  showTab(form, "What plays");
  fireEvent.click(within(form).getByLabelText(/Christmas Movies/));
  fireEvent.click(within(form).getByRole("button", { name: "OK" }));

  const dialog = await screen.findByRole("dialog", { name: REBUILD });
  expect(
    api.requestsTo(RULES).find((request) => request.method === "POST")?.body,
  ).toEqual({
    name: "December",
    behavior: "join",
    priority: 1,
    dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
    weekdays: null,
    window: null,
    sources: [
      {
        assignmentId: "christmas-turns",
        ordinaryStretch: null,
        marathon: { mode: "inherit" },
      },
    ],
  });
  expect(
    within(dialog).getByRole<HTMLInputElement>("radio", {
      name: "Let it finish",
    }).checked,
  ).toBe(true);
  expect(dialog.textContent).toMatch(
    /Alpha finishes, and the new lineup starts after it\./,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await within(dialog).findByText(/rebuilt after what is airing now/);
  // The rule save already regenerated after the airing program.
  expect(api.requestsTo("/channels/one/schedule/generate")).toEqual([]);
});

it("saves a rule without asking while nothing airs", async () => {
  const api = editorApi([], adminFixtures.offAir);
  api.reply(RULES, ruleFixture("december", "December", []), "POST");

  const form = await openNewRule(api);
  fireEvent.change(within(form).getByLabelText("Name"), {
    target: { value: "December" },
  });
  showTab(form, "What plays");
  fireEvent.click(within(form).getByLabelText(/Christmas Movies/));
  fireEvent.click(within(form).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(api.readAfterLastWrite(RULES)).toBe(true));
  expect(
    api.requestsTo(RULES).filter((request) => request.method === "POST"),
  ).toHaveLength(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers priorities 1 to 5, starts a new rule at 3, and says how overlapping rules combine", async () => {
  const api = editorApi();

  const form = await openNewRule(api);
  expect(
    screen.getByText(
      "Rules change what the channel plays on certain dates, days, or hours. Overlapping rules with the same priority play together; a higher priority takes over.",
    ),
  ).toBeDefined();
  const priority = within(form).getByLabelText<HTMLSelectElement>("Priority");

  expect(
    within(priority)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["1 (lowest)", "2", "3", "4", "5 (highest)"]);
  expect(chosenOption(priority)).toBe("3");
  expect(priority.getAttribute("aria-describedby")).not.toBeNull();
  expect(
    document.getElementById(priority.getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toBe(
    "Rules that overlap at the same priority play together. A higher priority takes over completely. For example, give Christmas Movies priority 4 and Saturday Cartoons priority 3, and a Christmas Saturday plays only Christmas movies. Give both priority 3, and they take turns.",
  );
});

it("saves a Friday evening feature with its own turn and marathon lengths", async () => {
  const api = editorApi();
  api.reply(RULES, ruleFixture("fridays", "Friday movies", []), "POST");

  const form = await openNewRule(api);
  fireEvent.change(within(form).getByLabelText("Name"), {
    target: { value: "Friday movies" },
  });
  fireEvent.click(within(form).getByLabelText("Take over the channel"));
  showTab(form, "When");
  fireEvent.click(within(form).getByLabelText("Fri"));
  fireEvent.click(within(form).getByLabelText("Only during certain hours"));
  fireEvent.change(within(form).getByLabelText("Starts"), {
    target: { value: "18:00" },
  });
  fireEvent.change(within(form).getByLabelText("Ends"), {
    target: { value: "23:00" },
  });
  showTab(form, "What plays");
  fireEvent.click(within(form).getByLabelText(/Christmas Movies/));
  const christmas = within(form).getByRole("group", {
    name: "Christmas Movies under this rule",
  });
  fireEvent.click(
    within(christmas).getByLabelText("Change how much plays at a time"),
  );
  chooseOption(within(christmas).getByLabelText("Plays at a time"), "2 movies");
  fireEvent.change(within(christmas).getByLabelText("Marathons"), {
    target: { value: "replace" },
  });
  fireEvent.change(
    within(christmas).getByLabelText("Marathon programs per turn"),
    { target: { value: "3" } },
  );
  fireEvent.click(within(form).getByRole("button", { name: "OK" }));

  await screen.findByRole("dialog", { name: REBUILD });
  expect(
    api.requestsTo(RULES).find((request) => request.method === "POST")?.body,
  ).toMatchObject({
    behavior: "feature",
    weekdays: [5],
    window: { startMinute: 18 * 60, endMinute: 23 * 60 },
    sources: [
      {
        assignmentId: "christmas-turns",
        ordinaryStretch: { kind: "programs", count: 2 },
        marathon: { mode: "replace", stretch: { kind: "programs", count: 3 } },
      },
    ],
  });
});

it("shows the server's message for an invalid size pair", async () => {
  const api = editorApi();
  api.reply(
    RULES,
    {
      error: {
        code: "programming_rule_stretch_invalid",
        message:
          "Rule settings for programming assignment christmas-turns are invalid: a marathon must be longer than the ordinary stretch",
      },
    },
    "POST",
    400,
  );

  const form = await openNewRule(api);
  fireEvent.change(within(form).getByLabelText("Name"), {
    target: { value: "Too long" },
  });
  showTab(form, "What plays");
  fireEvent.click(within(form).getByLabelText(/Christmas Movies/));
  fireEvent.click(
    within(form).getByLabelText("Change how much plays at a time"),
  );
  chooseOption(within(form).getByLabelText("Plays at a time"), "Custom…");
  fireEvent.change(within(form).getByLabelText("Programs per turn"), {
    target: { value: "4" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "OK" }));

  expect(
    await within(form).findByText(/marathon must be longer than the ordinary/),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: REBUILD })).toBeNull();
});

it("returns to What plays instead of saving a show's backwards range", async () => {
  const api = editorApi();
  const form = await openNewRule(api);
  fireEvent.change(within(form).getByLabelText("Name"), {
    target: { value: "Backwards" },
  });
  showTab(form, "What plays");
  fireEvent.click(within(form).getByLabelText(/Christmas Movies/));
  fireEvent.click(
    within(form).getByLabelText("Change how much plays at a time"),
  );
  chooseOption(within(form).getByLabelText("Plays at a time"), "Custom…");
  chooseOption(
    within(form).getByLabelText("Turn length"),
    "A time within a range",
  );
  fireEvent.change(within(form).getByLabelText("At least minutes"), {
    target: { value: "60" },
  });
  fireEvent.change(within(form).getByLabelText("At most minutes"), {
    target: { value: "30" },
  });
  showTab(form, "General");

  fireEvent.click(within(form).getByRole("button", { name: "OK" }));

  // The browser points at At most, which may not fall below At least.
  const most =
    await within(form).findByLabelText<HTMLInputElement>("At most minutes");
  expect(most.validity.rangeUnderflow).toBe(true);
  expect(
    api.requestsTo(RULES).filter((request) => request.method === "POST"),
  ).toEqual([]);
});

it("lists rules by priority and reorders only among equal priorities", async () => {
  const api = editorApi([
    ruleFixture("december", "December", ["christmas-turns"], { priority: 1 }),
    ruleFixture("fridays", "Friday movies", ["christmas-turns"], {
      priority: 2,
      behavior: "feature",
    }),
    ruleFixture("winter", "Winter", ["christmas-turns"], { priority: 1 }),
  ]);
  api.reply(`${RULES}/order`, [], "PUT");
  await openChannelTab(api, "Rules");

  const table = await screen.findByRole("table", { name: "Rules by priority" });
  await waitFor(() =>
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]?.textContent),
    ).toEqual(["Friday movies", "December", "Winter"]),
  );
  // Friday movies has no equal-priority neighbor to trade places with.
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Friday movies" }),
  );
  for (const command of ["Move up", "Move down"]) {
    expect(
      screen.getByRole<HTMLButtonElement>("menuitem", { name: command })
        .disabled,
    ).toBe(true);
  }
  // Closes Friday movies' menu before opening December's.
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Friday movies" }),
  );
  chooseRowCommand("December", "Move down");

  await screen.findByRole("dialog", { name: REBUILD });
  expect(api.requestsTo(`${RULES}/order`)[0]?.body).toEqual({
    ruleIds: ["winter", "fridays", "december"],
  });
});

it("deletes a rule and offers the rebuild choice", async () => {
  const api = editorApi([
    ruleFixture("december", "December", ["christmas-turns"]),
  ]);
  api.reply(`${RULES}/december`, undefined, "DELETE", 204);
  await openChannelTab(api, "Rules");

  await screen.findByRole("button", { name: "Actions for December" });
  chooseRowCommand("December", "Delete…");
  const confirm = screen.getByRole("dialog", { name: "Delete rule" });
  // Nothing is deleted until the owner confirms.
  expect(api.requestsTo(`${RULES}/december`)).toEqual([]);
  fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

  await screen.findByRole("dialog", { name: REBUILD });
  expect(
    api.requestsTo(`${RULES}/december`).map((request) => request.method),
  ).toEqual(["DELETE"]);
});

it("shows the tab holding a missing field when OK is pressed, and saves nothing", async () => {
  const api = editorApi();
  const form = await openNewRule(api);
  fireEvent.change(within(form).getByLabelText("Name"), {
    target: { value: "December" },
  });

  fireEvent.click(within(form).getByRole("button", { name: "OK" }));

  expect(
    within(form)
      .getByRole("tab", { name: "What plays" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(within(form).getByText("Check at least one.")).toBeTruthy();
  expect(
    api.requestsTo(RULES).filter((request) => request.method === "POST"),
  ).toEqual([]);
});

it("says in words when each rule applies, which shows it plays, and how", async () => {
  const api = editorApi([
    ruleFixture(
      "fridays",
      "Friday movies",
      ["christmas-turns", "favorites-turns"],
      {
        behavior: "feature",
        weekdays: [5],
      },
    ),
  ]);
  await openChannelTab(api, "Rules");

  const table = await screen.findByRole("table", { name: "Rules by priority" });
  // Each column has its own heading, the last one unlabeled for actions.
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["Rule", "When", "Plays", "While it applies", "Priority", ""]);
  const [, row] = within(table).getAllByRole("row");
  if (row === undefined) throw new Error("The rule should be listed");
  await waitFor(() =>
    expect(
      within(row)
        .getAllByRole("cell")
        .slice(0, 5)
        .map((cell) => cell.textContent),
    ).toEqual([
      "Friday movies",
      "Fridays",
      "Christmas Movies, Favorites",
      "Takes over the channel",
      "3",
    ]),
  );
});

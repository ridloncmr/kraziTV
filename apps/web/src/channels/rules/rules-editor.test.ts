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
import {
  adminFixtures,
  collectionWith,
  ruleFixture,
} from "../../testing/admin-fixtures.js";
import { ProgrammingEditor } from "../programming/programming-editor.js";

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
    participation,
    playbackMode: "chronological",
    ordinaryStretch: { kind: "programs", count: 1 },
    marathonStretch: { kind: "programs", count: 3 },
    members: [{ kind: "collection", mediaCollectionId: collectionId }],
  };
}

// The editor over Favorites in rotation and rule-only Christmas Movies.
function editorApi(rules: unknown[] = []) {
  const api = new BrowserApi();
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
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 1,
    turns: [],
    skips: [],
  });
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

// Opens the new-rule form.
async function openNewRule() {
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
  return screen.getByRole("group", { name: "New rule" });
}

it("shows the timezone rules follow, and saves a December join rule, letting the airing program finish", async () => {
  const api = editorApi();
  api.reply(RULES, ruleFixture("december", "December", []), "POST");

  const form = await openNewRule();
  expect((await screen.findByText(/America\/New_York/)).textContent).toMatch(
    /Rules follow the server's programming timezone, America\/New_York/,
  );
  fireEvent.change(within(form).getByLabelText("Rule name"), {
    target: { value: "December" },
  });
  fireEvent.change(within(form).getByLabelText("Priority"), {
    target: { value: "1" },
  });
  fireEvent.change(within(form).getByLabelText("Dates"), {
    target: { value: "annual" },
  });
  fireEvent.change(within(form).getByLabelText("From (MM-DD)"), {
    target: { value: "12-01" },
  });
  fireEvent.change(within(form).getByLabelText("Through (MM-DD)"), {
    target: { value: "12-31" },
  });
  fireEvent.click(within(form).getByLabelText("Christmas Movies"));
  fireEvent.click(within(form).getByRole("button", { name: "Save rule" }));

  const dialog = await screen.findByRole("dialog", {
    name: "Rebuild the schedule",
  });
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
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild" }));
  await within(dialog).findByText(/rebuilt after what is airing now/);
  // The rule save already regenerated after the airing program.
  expect(api.requestsTo("/channels/one/schedule/generate")).toEqual([]);
});

it("saves a Friday evening feature with its own turn and marathon lengths", async () => {
  const api = editorApi();
  api.reply(RULES, ruleFixture("fridays", "Friday movies", []), "POST");

  const form = await openNewRule();
  fireEvent.change(within(form).getByLabelText("Rule name"), {
    target: { value: "Friday movies" },
  });
  fireEvent.change(within(form).getByLabelText("Behavior"), {
    target: { value: "feature" },
  });
  fireEvent.click(within(form).getByLabelText("Fri"));
  fireEvent.click(within(form).getByLabelText("Only during a time window"));
  fireEvent.change(within(form).getByLabelText("Window starts"), {
    target: { value: "18:00" },
  });
  fireEvent.change(within(form).getByLabelText("Window ends"), {
    target: { value: "23:00" },
  });
  fireEvent.click(within(form).getByLabelText("Christmas Movies"));
  fireEvent.click(within(form).getByLabelText("Own turn length"));
  fireEvent.change(within(form).getByLabelText("Programs per turn"), {
    target: { value: "2" },
  });
  fireEvent.change(within(form).getByLabelText("Marathons under this rule"), {
    target: { value: "replace" },
  });
  fireEvent.change(within(form).getByLabelText("Marathon programs per turn"), {
    target: { value: "3" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Save rule" }));

  await screen.findByRole("dialog", { name: "Rebuild the schedule" });
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

  const form = await openNewRule();
  fireEvent.change(within(form).getByLabelText("Rule name"), {
    target: { value: "Too long" },
  });
  fireEvent.click(within(form).getByLabelText("Christmas Movies"));
  fireEvent.click(within(form).getByLabelText("Own turn length"));
  fireEvent.change(within(form).getByLabelText("Programs per turn"), {
    target: { value: "4" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Save rule" }));

  expect(
    await within(form).findByText(/marathon must be longer than the ordinary/),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
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
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  const list = await screen.findByRole("list", { name: "Rules by priority" });
  await waitFor(() =>
    expect(
      within(list)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Friday movies", "December", "Winter"]),
  );
  const items = within(list).getAllByRole("listitem");
  // Friday movies has no equal-priority neighbor to trade places with.
  expect(within(items[0]).queryByRole("button", { name: /Move/ })).toBeNull();
  fireEvent.click(within(items[1]).getByRole("button", { name: "Move down" }));

  await screen.findByRole("dialog", { name: "Rebuild the schedule" });
  expect(api.requestsTo(`${RULES}/order`)[0]?.body).toEqual({
    ruleIds: ["winter", "fridays", "december"],
  });
});

it("deletes a rule and offers the rebuild choice", async () => {
  const api = editorApi([
    ruleFixture("december", "December", ["christmas-turns"]),
  ]);
  api.reply(`${RULES}/december`, undefined, "DELETE", 204);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  const list = await screen.findByRole("list", { name: "Rules by priority" });
  fireEvent.click(
    await within(list).findByRole("button", { name: "Delete rule" }),
  );

  await screen.findByRole("dialog", { name: "Rebuild the schedule" });
  expect(
    api.requestsTo(`${RULES}/december`).map((request) => request.method),
  ).toEqual(["DELETE"]);
});

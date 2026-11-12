// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { applyStylesheet } from "../testing/apply-stylesheet.js";
import { styleRules } from "../testing/style-rules.js";
import type { TrayReminder } from "./contracts.js";
import { TrayReminders } from "./tray-reminders.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** A reminder whose condition holds, with its own storage key and words. */
function reminder(
  name: string,
  overrides: Partial<TrayReminder> = {},
): TrayReminder {
  return {
    storageKey: `krazitv.${name}Reminder`,
    words: {
      title: `${name} title`,
      sentence: `${name} sentence.`,
      quip: `${name} quip.`,
      action: `Do ${name}`,
    },
    shows: true,
    holds: true,
    act: () => {},
    ...overrides,
  };
}

/** A reminder that has stopped showing, as one whose condition ended. */
const ended = (name: string) => reminder(name, { shows: false, holds: false });

/** The tray's one icon, by whatever title it carries. */
const icon = () => screen.queryByRole("button", { name: /title$/ });

/** The open balloon, or null. */
const balloon = () => screen.queryByRole("dialog");

/** Reads one reminder's stored choice. */
const stored = (name: string) =>
  JSON.parse(
    localStorage.getItem(`krazitv.${name}Reminder`) ?? "null",
  ) as unknown;

it("opens only the first holding reminder, and the icon names that one", async () => {
  render(
    createElement(TrayReminders, {
      reminders: [ended("hidden"), reminder("first"), reminder("second")],
    }),
  );

  expect(
    await screen.findByRole("dialog", { name: "first title" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(icon()!.getAttribute("aria-label")).toBe("first title");
});

it("hands the icon to the next reminder when the first ends, which then opens by itself once", async () => {
  const { rerender } = render(
    createElement(TrayReminders, {
      reminders: [reminder("first"), reminder("second")],
    }),
  );
  await screen.findByRole("dialog", { name: "first title" });

  rerender(
    createElement(TrayReminders, {
      reminders: [ended("first"), reminder("second")],
    }),
  );
  expect(
    await screen.findByRole("dialog", { name: "second title" }),
  ).toBeTruthy();
  expect(icon()!.getAttribute("aria-label")).toBe("second title");

  // The first returns and takes the icon back, but has had its turn.
  rerender(
    createElement(TrayReminders, {
      reminders: [reminder("first"), reminder("second")],
    }),
  );
  expect(balloon()).toBeNull();
  expect(icon()!.getAttribute("aria-label")).toBe("first title");
});

it("never opens a reminder by itself while it only shows, but its icon opens it with focus", () => {
  render(
    createElement(TrayReminders, {
      reminders: [reminder("first", { holds: false })],
    }),
  );
  expect(balloon()).toBeNull();

  fireEvent.click(icon()!);

  const opened = screen.getByRole("dialog", { name: "first title" });
  expect(document.activeElement).toBe(
    within(opened).getByRole("button", { name: "Do first" }),
  );
});

it("runs the main action and snoozes only that reminder", () => {
  const act = vi.fn();
  render(
    createElement(TrayReminders, {
      reminders: [reminder("first", { act }), reminder("second")],
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Do first" }));

  expect(act).toHaveBeenCalledOnce();
  expect(balloon()).toBeNull();
  expect(stored("first")).toMatchObject({ remindAfter: expect.any(Number) });
  expect(stored("second")).toBeNull();
});

it.each([
  ["Remind me later", { remindAfter: expect.any(Number) }],
  ["Close", { remindAfter: expect.any(Number) }],
  ["Escape", { remindAfter: expect.any(Number) }],
  ["Don't remind me", { never: true }],
])(
  "stores %s under the answered reminder alone, so the next still opens by itself",
  async (answer, choice) => {
    const { rerender } = render(
      createElement(TrayReminders, {
        reminders: [reminder("first"), reminder("second")],
      }),
    );
    const opened = await screen.findByRole("dialog", { name: "first title" });

    if (answer === "Escape") fireEvent.keyDown(opened, { key: "Escape" });
    else fireEvent.click(within(opened).getByRole("button", { name: answer }));

    expect(balloon()).toBeNull();
    expect(stored("first")).toEqual(choice);
    expect(stored("second")).toBeNull();
    rerender(
      createElement(TrayReminders, {
        reminders: [ended("first"), reminder("second")],
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "second title" }),
    ).toBeTruthy();
  },
);

it("keeps the balloon's rise out of reduced motion in the stylesheet that draws it", () => {
  applyStylesheet("tray-reminders/tray-reminders.css");
  render(createElement(TrayReminders, { reminders: [reminder("first")] }));
  const opened = screen.getByRole("dialog", { name: "first title" });
  const rules = styleRules().filter(({ rule }) =>
    opened.matches(rule.selectorText),
  );

  // It rises and fades in by default, and only fades under reduced motion.
  expect(
    rules.some(
      ({ rule, media }) =>
        media === null && rule.style.transition.includes("transform"),
    ),
  ).toBe(true);
  const reduced = rules.filter(
    ({ media }) => media === "(prefers-reduced-motion: reduce)",
  );
  expect(reduced.map(({ rule }) => rule.style.transitionProperty)).toEqual([
    "opacity",
  ]);
});

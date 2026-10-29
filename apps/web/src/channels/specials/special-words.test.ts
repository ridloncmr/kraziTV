import { describe, expect, it } from "vitest";
import { displayTime } from "../../controls/formatting/display-time.js";
import { airtimeWords, specialWords } from "./special-words.js";

const START = "2099-06-01T20:00:00.000Z";
const END = "2099-06-01T21:30:00.000Z";

describe("specialWords", () => {
  // Every refusal the server can answer a special preview or save with, and
  // the sentence the owner reads for it; none names an ID or says reservation.
  it.each([
    [
      "media_item_not_found",
      { mediaItemIds: ["item-1"] },
      /no longer in the catalog/,
    ],
    [
      "media_collection_not_found",
      { mediaCollectionId: "c-1" },
      /no longer exists/,
    ],
    [
      "reservation_does_not_fit",
      { programsEndAt: END },
      /run past the end, until/,
    ],
    ["reservation_in_past", { startsAt: START }, /start in the future/],
    ["reservation_started", { startsAt: START }, /End it early instead/],
    [
      "reservation_not_started",
      { startsAt: START },
      /Edit or cancel it instead/,
    ],
    [
      "reservation_too_far",
      { latestStartsAt: START },
      /at most a year ahead, by/,
    ],
    ["preview_stale", {}, /Preview again before saving/],
    ["reservation_ended", { endsAt: END }, /already ended/],
    [
      "reservation_end_out_of_range",
      { earliestEndsAt: START, latestEndsAt: END },
      /through its current end/,
    ],
    [
      "airing_filler_conflict",
      { fillerEndsAt: END },
      /off air until this special/,
    ],
    [
      "reservation_crosses_airing",
      { airingEndsAt: END },
      /before what is airing ends at/,
    ],
    [
      "reservation_overlap",
      { reservationId: "r-1", startsAt: START, endsAt: END },
      /overlaps the special airing/,
    ],
    [
      "reservation_media_unplayable",
      { mediaItemIds: ["item-1"] },
      /cannot air/,
    ],
    [
      "reservation_media_unplayable",
      { mediaItemIds: [] },
      /nothing to air yet/,
    ],
    ["reservation_not_found", { reservationId: "r-1" }, /no longer exists/],
  ] as const)("words %s for the owner", (code, details, expected) => {
    const words = specialWords(code, { ...details });
    expect(words).toMatch(expected);
    expect(words).not.toMatch(/reservation|item-1|c-1|r-1/);
  });

  it("names the other special by its airtime, never its ID", () => {
    expect(
      specialWords("reservation_overlap", {
        reservationId: "r-1",
        startsAt: START,
        endsAt: END,
      }),
    ).toBe(
      `It overlaps the special airing ${airtimeWords({ startsAt: START, endsAt: END })}. Change its start or end.`,
    );
    expect(specialWords("reservation_overlap", { reservationId: "r-1" })).toBe(
      "It overlaps another special. Change its start or end.",
    );
  });

  it("names an instant by the clock only when the details carry it", () => {
    expect(specialWords("reservation_too_far", { latestStartsAt: START })).toBe(
      `A special can start at most a year ahead, by ${displayTime(START)}. Pick an earlier start.`,
    );
    expect(specialWords("reservation_too_far", {})).toBe(
      "A special can start at most a year ahead. Pick an earlier start.",
    );
  });

  it("has no words for a code it does not know, so the server's message shows", () => {
    expect(specialWords("channel_unschedulable", {})).toBeUndefined();
  });
});

describe("airtimeWords", () => {
  const day = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  const clock = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  it("names the date once when the special ends the day it starts", () => {
    expect(airtimeWords({ startsAt: START, endsAt: END })).toBe(
      `${day(START)} · ${clock(START)} – ${clock(END)}`,
    );
  });

  it("names the end's date too when it falls on another day", () => {
    // Over a day later, so it falls on another local day in every timezone.
    const nextDay = "2099-06-02T22:00:00.000Z";
    expect(airtimeWords({ startsAt: START, endsAt: nextDay })).toBe(
      `${day(START)} · ${clock(START)} – ${day(nextDay)} ${clock(nextDay)}`,
    );
  });
});

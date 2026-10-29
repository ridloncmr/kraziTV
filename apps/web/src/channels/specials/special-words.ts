import {
  displayClockTime,
  displayTime,
} from "../../controls/formatting/display-time.js";

// The owner's words for specials: what a refusal asks them to change, and
// how a special's airtime is named. The API says reservation; every sentence
// here says special (release-polish spec 0002).

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * Says when a special airs, such as `Sat, Oct 24 · 8:00 PM – 10:00 PM`,
 * naming the end's date too when it falls on another day.
 */
export function airtimeWords(special: {
  startsAt: string;
  endsAt: string;
}): string {
  const startDate = dateFormat.format(new Date(special.startsAt));
  const endDate = dateFormat.format(new Date(special.endsAt));
  const endClock = displayClockTime(special.endsAt);
  return `${startDate} · ${displayClockTime(special.startsAt)} – ${startDate === endDate ? "" : `${endDate} `}${endClock}`;
}

/**
 * Words a special refusal the way the owner can act on it: what to change,
 * naming another special by its time and an instant by the clock, never
 * by an ID. A code this file does not know gets nothing, so the server's
 * message shows instead and no refusal is silently lost.
 */
export function specialWords(
  code: string,
  details: Record<string, unknown>,
): string | undefined {
  // Names an instant from the details, or nothing when it was not sent.
  const at = (key: string, word: (value: string) => string) =>
    typeof details[key] === "string" ? word(details[key]) : "";
  switch (code) {
    case "media_item_not_found":
      return "Some of the chosen media is no longer in the catalog. Pick it again.";
    case "media_collection_not_found":
      return "That collection no longer exists. Pick another.";
    case "reservation_does_not_fit":
      return `The programs run past the end${at("programsEndAt", (value) => `, until ${displayTime(value)}`)}. Move the end later or list fewer programs.`;
    case "reservation_in_past":
      return "A special must start in the future. Pick a later start.";
    case "reservation_started":
      return "This special has started, so it can no longer be edited. End it early instead.";
    case "reservation_not_started":
      return "This special has not started, so it cannot end early. Edit or cancel it instead.";
    case "reservation_too_far":
      return `A special can start at most a year ahead${at("latestStartsAt", (value) => `, by ${displayTime(value)}`)}. Pick an earlier start.`;
    case "preview_stale":
      return "The schedule changed since this preview. Preview again before saving.";
    case "reservation_ended":
      return "This special has already ended.";
    case "reservation_end_out_of_range":
      return `A special on air can end any time from now through its current end${at("latestEndsAt", (value) => `, ${displayTime(value)}`)}. Pick a time in between.`;
    case "airing_filler_conflict":
      return `The channel is off air until this special, so it cannot change now${at("fillerEndsAt", (value) => `. Try again after ${displayTime(value)}`)}.`;
    case "reservation_crosses_airing":
      return `This special starts before what is airing ends${at("airingEndsAt", (value) => ` at ${displayTime(value)}`)}. Let it finish, or stop it at the special's start.`;
    case "reservation_overlap":
      return typeof details.startsAt === "string" &&
        typeof details.endsAt === "string"
        ? `It overlaps the special airing ${airtimeWords({ startsAt: details.startsAt, endsAt: details.endsAt })}. Change its start or end.`
        : "It overlaps another special. Change its start or end.";
    case "reservation_media_unplayable":
      return Array.isArray(details.mediaItemIds) &&
        details.mediaItemIds.length === 0
        ? "This collection has nothing to air yet. Add media to it first."
        : "Some of the chosen media cannot air. Pick media that is available.";
    case "reservation_not_found":
      return "This special no longer exists. Refresh the list.";
    default:
      return undefined;
  }
}

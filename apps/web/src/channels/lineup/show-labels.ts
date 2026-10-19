import type { StretchSetting } from "../../http/contracts/programming.js";

// Lineup words for a show's settings. They only describe saved values; the
// server still validates every setting and kraziPlan decides what airs.

/** Words how much of a show airs per sitting, such as `3 programs` or `~1 hr`. */
export function perSittingLabel(stretch: StretchSetting): string {
  switch (stretch.kind) {
    case "programs":
      return programsWords(stretch.count);
    case "airtime":
      return `~${minutesWords(stretch.minutes)}`;
    case "airtime_range":
      return `${minutesWords(stretch.minMinutes)} to ${minutesWords(stretch.maxMinutes)}`;
  }
}

/** Words the longest a show's marathon runs, such as `up to 3 hrs`; `—` when it cannot marathon. */
export function marathonLabel(stretch: StretchSetting | null): string {
  if (stretch === null) return "—";
  switch (stretch.kind) {
    case "programs":
      return `up to ${programsWords(stretch.count)}`;
    case "airtime":
      return `up to ${minutesWords(stretch.minutes)}`;
    case "airtime_range":
      return `up to ${minutesWords(stretch.maxMinutes)}`;
  }
}

/**
 * Names a show by its members joined with `+`, naming two at most and
 * counting the rest, so a long member list keeps the lineup row short.
 */
export function joinShowNames(names: readonly string[]): string {
  const shown = names.slice(0, 2).join(" + ");
  return names.length > 2 ? `${shown} + ${names.length - 2} more` : shown;
}

// Counts programs in words, singular for one.
function programsWords(count: number): string {
  return count === 1 ? "1 program" : `${count} programs`;
}

// Words whole minutes as hours and minutes, such as `1 hr 30 min`.
function minutesWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  const hourWords = hours === 1 ? "1 hr" : `${hours} hrs`;
  return rest === 0 ? hourWords : `${hourWords} ${rest} min`;
}

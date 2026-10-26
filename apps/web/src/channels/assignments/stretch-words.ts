import type { StretchSetting } from "../../http/contracts/programming.js";
import type { ContentKind } from "../contracts.js";

// Words for saved stretch settings, in the units of the show's content.
// They only describe values; the server still validates every setting.

/**
 * Words how much of a show airs per sitting, such as `3 episodes` or
 * `~1 hr`. A per-sitting preset's label is its words, so a saved setting
 * reads the same whether or not it matches a preset.
 */
export function perSittingLabel(
  stretch: StretchSetting,
  kind: ContentKind,
): string {
  switch (stretch.kind) {
    case "programs":
      return countWords(stretch.count, kind);
    case "airtime":
      return `~${minutesWords(stretch.minutes)}`;
    case "airtime_range":
      return `${minutesWords(stretch.minMinutes)} to ${minutesWords(stretch.maxMinutes)}`;
  }
}

/** Words the longest a show's marathon runs, such as `up to 3 hrs`; nothing when it cannot marathon, the usual case. */
export function marathonLabel(
  stretch: StretchSetting | null,
  kind: ContentKind,
): string {
  if (stretch === null) return "";
  switch (stretch.kind) {
    case "programs":
      return `up to ${countWords(stretch.count, kind)}`;
    case "airtime":
      return `up to ${minutesWords(stretch.minutes)}`;
    case "airtime_range":
      return `up to ${minutesWords(stretch.maxMinutes)}`;
  }
}

// Counts programs in the content's unit, singular for one.
function countWords(count: number, kind: ContentKind): string {
  const unit =
    kind === "movies" ? "movie" : kind === "episodes" ? "episode" : "program";
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}

// Words whole minutes as hours and minutes, such as `1 hr 30 min`.
function minutesWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  const hourWords = hours === 1 ? "1 hr" : `${hours} hrs`;
  return rest === 0 ? hourWords : `${hourWords} ${rest} min`;
}

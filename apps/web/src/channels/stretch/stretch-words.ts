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

/**
 * Counts programs in the content's unit, such as `1 episode` or `3 movies`;
 * `program` when the kind is unknown. A `qualifier` sits between the count
 * and the unit, as in `1 more episode`, so the unit keeps one spelling.
 */
export function countWords(
  count: number,
  kind: ContentKind,
  qualifier?: string,
): string {
  const unit =
    kind === "movies" ? "movie" : kind === "episodes" ? "episode" : "program";
  const counted =
    qualifier === undefined ? `${count}` : `${count} ${qualifier}`;
  return count === 1 ? `${counted} ${unit}` : `${counted} ${unit}s`;
}

/**
 * What to change when a marathon length cannot pair with Plays at a time.
 * The sheet holds saving with these words, and a refusal the server made
 * on the same check says them too, so the owner reads one sentence for one
 * problem (release-polish spec 0004).
 */
export const MARATHON_PROBLEM_WORDS = {
  shorter: "Make the marathon longer than Plays at a time.",
  unit: "Set the marathon in the same unit as Plays at a time: programs with programs, minutes with minutes.",
} as const;

/**
 * Words the stretch problem a rule refusal carries in `details.problem`,
 * kraziBrain's own sentence, as what to change. The two pair checks are
 * told apart by a word only each uses; any other problem is a value the
 * fields refuse, so the sentence is theirs.
 */
export function stretchProblemWords(problem: unknown): string {
  const text = typeof problem === "string" ? problem : "";
  if (text.includes("unit")) return MARATHON_PROBLEM_WORDS.unit;
  if (text.includes("longer")) return MARATHON_PROBLEM_WORDS.shorter;
  return "Use whole numbers of 1 or more, and make At most minutes no less than At least minutes.";
}

/** Words whole minutes as hours and minutes, such as `1 hr 30 min`. */
export function minutesWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  const hourWords = hours === 1 ? "1 hr" : `${hours} hrs`;
  return rest === 0 ? hourWords : `${hourWords} ${rest} min`;
}

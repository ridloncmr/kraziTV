import type {
  ProgrammingRule,
  RuleMarathon,
  RuleSettings,
  StretchSetting,
} from "../../http/contracts/programming.js";
import {
  isStretchComplete,
  type StretchDraft,
  suggestMarathon,
  toStretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "../assignments/stretch-fields.js";
import type { ContentKind } from "../contracts.js";

/** One show a rule can select, named as the lineup names it. */
export interface RuleSourceChoice {
  assignmentId: string;
  label: string;
  /** It airs only while a rule selects it. */
  ruleOnly: boolean;
  /** The show's own sizes, which a selected show starts from. */
  ordinaryStretch: StretchSetting;
  /** Words the show's per-sitting presets for what it plays. */
  contentKind: ContentKind;
}

/** One selected show as the rule dialog edits it. */
export interface SourceDraft {
  ownLength: boolean;
  ordinary: StretchDraft;
  marathonMode: RuleMarathon["mode"];
  marathon: StretchDraft;
}

/** Everything the rule dialog edits, with dates and times as their inputs hold them. */
export interface RuleDraft {
  name: string;
  behavior: RuleSettings["behavior"];
  priority: number;
  dateKind: RuleSettings["dates"]["kind"];
  start: string;
  end: string;
  weekdays: number[];
  windowOn: boolean;
  windowStart: string;
  windowEnd: string;
  sources: Map<string, SourceDraft>;
}

/** The rule dialog's property-sheet tabs, in the order they show. */
export type RuleTab = "general" | "when" | "shows";

// An annual date as its input holds it, such as 12-01.
const MONTH_DAY = /^\d{2}-\d{2}$/;

/** Starts a newly selected show from its own turn length. */
export function newSource(choice: RuleSourceChoice): SourceDraft {
  const ordinary = toStretchDraft(choice.ordinaryStretch);
  return {
    ownLength: false,
    ordinary,
    marathonMode: "inherit",
    marathon: suggestMarathon(ordinary),
  };
}

// The middle of the 1 to 5 scale, so one rule can later be raised or
// lowered without renumbering the others (programming spec 0009).
const NEW_RULE_PRIORITY = 3;

/**
 * Shows a saved rule in the dialog, or an empty one for a new rule. A show
 * that inherits its own sizes starts from them, as a newly selected one
 * does.
 */
export function toRuleDraft(
  rule: ProgrammingRule | undefined,
  choices: readonly RuleSourceChoice[],
): RuleDraft {
  const { dates } = rule ?? { dates: { kind: "any" as const } };
  return {
    name: rule?.name ?? "",
    behavior: rule?.behavior ?? "join",
    priority: rule?.priority ?? NEW_RULE_PRIORITY,
    dateKind: dates.kind,
    start:
      dates.kind === "one_off"
        ? dates.startDate
        : dates.kind === "annual"
          ? dates.startMonthDay
          : "",
    end:
      dates.kind === "one_off"
        ? dates.endDate
        : dates.kind === "annual"
          ? dates.endMonthDay
          : "",
    weekdays: rule?.weekdays ?? [],
    windowOn: rule?.window != null,
    windowStart: rule?.window ? toClock(rule.window.startMinute) : "",
    windowEnd: rule?.window ? toClock(rule.window.endMinute) : "",
    sources: new Map(
      (rule?.sources ?? []).map((source) => {
        const inherited = choices.find(
          ({ assignmentId }) => assignmentId === source.assignmentId,
        )?.ordinaryStretch;
        const ordinary =
          source.ordinaryStretch !== null
            ? toStretchDraft(source.ordinaryStretch)
            : inherited === undefined
              ? UNCHOSEN_STRETCH
              : toStretchDraft(inherited);
        return [
          source.assignmentId,
          {
            ownLength: source.ordinaryStretch !== null,
            ordinary,
            marathonMode: source.marathon.mode,
            marathon:
              source.marathon.mode === "replace"
                ? toStretchDraft(source.marathon.stretch)
                : suggestMarathon(ordinary),
          },
        ];
      }),
    ),
  };
}

/**
 * Names the first tab holding a field the rule cannot save without, so OK
 * can show it; only the shown tab's fields are in the form for the browser
 * to check.
 */
export function firstIncompleteTab(draft: RuleDraft): RuleTab | undefined {
  if (draft.name.trim() === "") return "general";
  const datesIncomplete =
    draft.dateKind !== "any" &&
    (draft.start === "" ||
      draft.end === "" ||
      (draft.dateKind === "annual" &&
        !(MONTH_DAY.test(draft.start) && MONTH_DAY.test(draft.end))));
  const windowIncomplete =
    draft.windowOn && (draft.windowStart === "" || draft.windowEnd === "");
  if (datesIncomplete || windowIncomplete) return "when";
  const sourceIncomplete = [...draft.sources.values()].some(
    (source) =>
      (source.ownLength && !isStretchComplete(source.ordinary)) ||
      (source.marathonMode === "replace" &&
        !isStretchComplete(source.marathon)),
  );
  if (draft.sources.size === 0 || sourceIncomplete) return "shows";
  return undefined;
}

/**
 * Builds the rule the dialog describes. Shows keep their saved order, with
 * newly selected ones after them, so saving an unchanged rule changes
 * nothing.
 */
export function toRuleSettings(draft: RuleDraft): RuleSettings {
  return {
    name: draft.name,
    behavior: draft.behavior,
    priority: draft.priority,
    dates:
      draft.dateKind === "one_off"
        ? { kind: "one_off", startDate: draft.start, endDate: draft.end }
        : draft.dateKind === "annual"
          ? {
              kind: "annual",
              startMonthDay: draft.start,
              endMonthDay: draft.end,
            }
          : { kind: "any" },
    weekdays: draft.weekdays.length === 0 ? null : draft.weekdays,
    window: draft.windowOn
      ? {
          startMinute: toMinutes(draft.windowStart),
          endMinute: toMinutes(draft.windowEnd),
        }
      : null,
    sources: [...draft.sources].map(([assignmentId, source]) => ({
      assignmentId,
      ordinaryStretch: source.ownLength
        ? toStretchSetting(source.ordinary)
        : null,
      marathon:
        source.marathonMode === "replace"
          ? { mode: "replace", stretch: toStretchSetting(source.marathon) }
          : { mode: source.marathonMode },
    })),
  };
}

/** Local minutes after midnight from an `HH:MM` time input. */
function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** An `HH:MM` time input value from local minutes after midnight. */
function toClock(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

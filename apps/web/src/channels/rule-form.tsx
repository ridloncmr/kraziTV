import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type {
  ProgrammingRule,
  RuleMarathon,
  RuleSettings,
  StretchSetting,
} from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import {
  type StretchDraft,
  StretchFields,
  suggestMarathon,
  toStretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "./stretch-fields.js";

/** Local weekday names, 0 for Sunday, as rules number them. */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One assignment the form can select, named as the owner knows it. */
export interface RuleSourceChoice {
  assignmentId: string;
  label: string;
  /** The assignment's own sizes, which a selected source starts from. */
  ordinaryStretch: StretchSetting;
}

/** One selected source as the form edits it. */
interface SourceDraft {
  ownLength: boolean;
  ordinary: StretchDraft;
  marathonMode: RuleMarathon["mode"];
  marathon: StretchDraft;
}

/** Everything the form edits, with dates and times as their inputs hold them. */
interface RuleDraft {
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

/**
 * Edits one programming rule, or adds one when none is given: its name,
 * behavior, priority, calendar conditions in the server's programming
 * timezone, and the assignments it selects, each with optional sizes that
 * apply only while the rule wins. The server validates everything and its
 * message shows here; `saved` runs after a write it accepted.
 */
export function RuleForm({
  path,
  rule,
  legend,
  choices,
  saved,
  onCancel,
}: {
  /** The rules collection for a new rule, or the rule's own path. */
  path: string;
  rule?: ProgrammingRule | undefined;
  legend: string;
  choices: readonly RuleSourceChoice[];
  saved: () => void;
  onCancel: () => void;
}) {
  const mutation = useMutation();
  const [draft, setDraft] = useState<RuleDraft>(() => toDraft(rule));
  // Applies one change to the draft.
  const edit = (change: Partial<RuleDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  // Applies one change to a selected source.
  const editSource = (assignmentId: string, change: Partial<SourceDraft>) =>
    setDraft((current) => {
      const sources = new Map(current.sources);
      const source = sources.get(assignmentId);
      if (source !== undefined)
        sources.set(assignmentId, { ...source, ...change });
      return { ...current, sources };
    });
  return (
    <fieldset disabled={mutation.pending}>
      <legend>{legend}</legend>
      <RequestFeedback
        loading={mutation.pending}
        error={mutation.error}
        message={mutation.message}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run(
            path,
            rule ? "PATCH" : "POST",
            toSettings(draft, choices),
            saved,
          );
        }}
      >
        <div className="inline-form">
          <label>
            Rule name
            <input
              required
              value={draft.name}
              onChange={(event) => edit({ name: event.target.value })}
            />
          </label>
          <label>
            Behavior
            <select
              value={draft.behavior}
              onChange={(event) =>
                edit({ behavior: event.target.value as RuleDraft["behavior"] })
              }
            >
              <option value="join">Join normal rotation</option>
              <option value="feature">Feature in a window</option>
            </select>
          </label>
          <label>
            Priority
            <input
              type="number"
              required
              step={1}
              value={Number.isNaN(draft.priority) ? "" : draft.priority}
              onChange={(event) =>
                edit({ priority: event.target.valueAsNumber })
              }
            />
          </label>
        </div>
        <p className="secondary">
          {draft.behavior === "join"
            ? "Its sources take turns alongside normal rotation while it applies."
            : "Only its sources take turns while it applies; normal rotation resumes afterward."}{" "}
          When rules overlap, the highest priority wins.
        </p>
        <div className="inline-form">
          <label>
            Dates
            <select
              value={draft.dateKind}
              onChange={(event) =>
                edit({
                  dateKind: event.target.value as RuleDraft["dateKind"],
                  start: "",
                  end: "",
                })
              }
            >
              <option value="any">Any date</option>
              <option value="one_off">A date range</option>
              <option value="annual">Every year</option>
            </select>
          </label>
          {draft.dateKind === "one_off" && (
            <>
              <label>
                From
                <input
                  type="date"
                  required
                  value={draft.start}
                  onChange={(event) => edit({ start: event.target.value })}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  required
                  value={draft.end}
                  onChange={(event) => edit({ end: event.target.value })}
                />
              </label>
            </>
          )}
          {draft.dateKind === "annual" && (
            <>
              <label>
                From (MM-DD)
                <input
                  required
                  pattern="\d{2}-\d{2}"
                  value={draft.start}
                  onChange={(event) => edit({ start: event.target.value })}
                />
              </label>
              <label>
                Through (MM-DD)
                <input
                  required
                  pattern="\d{2}-\d{2}"
                  value={draft.end}
                  onChange={(event) => edit({ end: event.target.value })}
                />
              </label>
            </>
          )}
        </div>
        <fieldset className="inline-form">
          <legend>Days (none means every day)</legend>
          {WEEKDAYS.map((day, index) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={draft.weekdays.includes(index)}
                onChange={(event) =>
                  edit({
                    weekdays: event.target.checked
                      ? [...draft.weekdays, index].sort()
                      : draft.weekdays.filter((other) => other !== index),
                  })
                }
              />
              {day}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={draft.windowOn}
            onChange={(event) => edit({ windowOn: event.target.checked })}
          />
          Only during a time window
        </label>
        {draft.windowOn && (
          <div className="inline-form">
            <label>
              Window starts
              <input
                type="time"
                required
                value={draft.windowStart}
                onChange={(event) => edit({ windowStart: event.target.value })}
              />
            </label>
            <label>
              Window ends
              <input
                type="time"
                required
                value={draft.windowEnd}
                onChange={(event) => edit({ windowEnd: event.target.value })}
              />
            </label>
            <small className="secondary">
              A window ending before it starts runs past midnight and counts as
              the day it started. It is checked between programs, so a program
              already airing finishes first.
            </small>
          </div>
        )}
        <fieldset>
          <legend>Sources</legend>
          {choices.map((choice) => {
            const source = draft.sources.get(choice.assignmentId);
            return (
              <div key={choice.assignmentId}>
                <label>
                  <input
                    type="checkbox"
                    checked={source !== undefined}
                    onChange={(event) =>
                      setDraft((current) => {
                        const sources = new Map(current.sources);
                        if (event.target.checked) {
                          sources.set(choice.assignmentId, newSource(choice));
                        } else {
                          sources.delete(choice.assignmentId);
                        }
                        return { ...current, sources };
                      })
                    }
                  />
                  {choice.label}
                </label>
                {source !== undefined && (
                  <div className="inline-form">
                    <label>
                      <input
                        type="checkbox"
                        checked={source.ownLength}
                        onChange={(event) =>
                          editSource(choice.assignmentId, {
                            ownLength: event.target.checked,
                          })
                        }
                      />
                      Own turn length
                    </label>
                    {source.ownLength && (
                      <StretchFields
                        draft={source.ordinary}
                        onChange={(ordinary) =>
                          editSource(choice.assignmentId, { ordinary })
                        }
                      />
                    )}
                    <label>
                      Marathons under this rule
                      <select
                        value={source.marathonMode}
                        onChange={(event) =>
                          editSource(choice.assignmentId, {
                            marathonMode: event.target
                              .value as RuleMarathon["mode"],
                            marathon: suggestMarathon(source.ordinary),
                          })
                        }
                      >
                        <option value="inherit">As the assignment sets</option>
                        <option value="disabled">None</option>
                        <option value="replace">Their own length</option>
                      </select>
                    </label>
                    {source.marathonMode === "replace" && (
                      <StretchFields
                        marathon
                        draft={source.marathon}
                        onChange={(marathon) =>
                          editSource(choice.assignmentId, { marathon })
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="row-actions">
          <button type="submit" disabled={draft.sources.size === 0}>
            Save rule
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </fieldset>
  );
}

/** Starts a selected source from its assignment's own turn length. */
function newSource(choice: RuleSourceChoice): SourceDraft {
  const ordinary = toStretchDraft(choice.ordinaryStretch);
  return {
    ownLength: false,
    ordinary,
    marathonMode: "inherit",
    marathon: suggestMarathon(ordinary),
  };
}

/** Shows a saved rule in the form, or an empty one for a new rule. */
function toDraft(rule: ProgrammingRule | undefined): RuleDraft {
  const { dates } = rule ?? { dates: { kind: "any" as const } };
  return {
    name: rule?.name ?? "",
    behavior: rule?.behavior ?? "join",
    priority: rule?.priority ?? 0,
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
      (rule?.sources ?? []).map((source) => [
        source.assignmentId,
        {
          ownLength: source.ordinaryStretch !== null,
          ordinary:
            source.ordinaryStretch === null
              ? UNCHOSEN_STRETCH
              : toStretchDraft(source.ordinaryStretch),
          marathonMode: source.marathon.mode,
          marathon:
            source.marathon.mode === "replace"
              ? toStretchDraft(source.marathon.stretch)
              : UNCHOSEN_STRETCH,
        },
      ]),
    ),
  };
}

/** Builds the rule the form describes, sources in the channel's assignment order. */
function toSettings(
  draft: RuleDraft,
  choices: readonly RuleSourceChoice[],
): RuleSettings {
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
    sources: choices.flatMap(({ assignmentId }) => {
      const source = draft.sources.get(assignmentId);
      if (source === undefined) return [];
      return [
        {
          assignmentId,
          ordinaryStretch: source.ownLength
            ? toStretchSetting(source.ordinary)
            : null,
          marathon:
            source.marathonMode === "replace"
              ? { mode: "replace", stretch: toStretchSetting(source.marathon) }
              : { mode: source.marathonMode },
        },
      ];
    }),
  };
}

/** Local minutes after midnight from an `HH:MM` time input. */
function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** An `HH:MM` time input value from local minutes after midnight. */
export function toClock(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

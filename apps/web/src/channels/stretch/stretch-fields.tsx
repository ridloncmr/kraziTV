import { useId } from "react";
import type { StretchSetting } from "../../http/contracts/programming.js";

/** A stretch as the form edits it; a value not entered yet is NaN. */
export interface StretchDraft {
  kind: StretchSetting["kind"];
  count: number;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
}

/** A stretch nobody has chosen yet; its required fields block saving. */
export const UNCHOSEN_STRETCH: StretchDraft = {
  kind: "programs",
  count: NaN,
  minutes: NaN,
  minMinutes: NaN,
  maxMinutes: NaN,
};

/** Shows a saved or suggested stretch in the form, keeping the other kinds empty. */
export function toStretchDraft(stretch: StretchSetting): StretchDraft {
  return { ...UNCHOSEN_STRETCH, ...stretch };
}

/** Sends the draft's chosen kind with only that kind's fields; the server validates them. */
export function toStretchSetting(draft: StretchDraft): StretchSetting {
  switch (draft.kind) {
    case "programs":
      return { kind: "programs", count: draft.count };
    case "airtime":
      return { kind: "airtime", minutes: draft.minutes };
    case "airtime_range":
      return {
        kind: "airtime_range",
        minMinutes: draft.minMinutes,
        maxMinutes: draft.maxMinutes,
      };
  }
}

/** Why a draft cannot be saved yet, as the words that ask for a fix name it. */
export type StretchProblem = "incomplete" | "backwards";

/**
 * Why a draft cannot be saved, or null when it can. A field its input
 * refuses, empty, zero, or a fraction, leaves it incomplete; a range whose
 * most is below its least is backwards, while equal ends are a fixed
 * target. Each matches what the browser checks on the field itself, so a
 * check made from another tab, or before the browser's own, agrees with it.
 */
export function stretchProblem(draft: StretchDraft): StretchProblem | null {
  const setting = toStretchSetting(draft);
  const whole = Object.values(setting).every(
    (value) =>
      typeof value !== "number" || (Number.isSafeInteger(value) && value >= 1),
  );
  if (!whole) return "incomplete";
  return setting.kind === "airtime_range" &&
    setting.maxMinutes < setting.minMinutes
    ? "backwards"
    : null;
}

/** Whether a draft can be saved: every field filled as its input accepts, and any range in order. */
export function isStretchComplete(draft: StretchDraft): boolean {
  return stretchProblem(draft) === null;
}

// Each turn length the editor offers.
const KIND_CHOICES: readonly { kind: StretchDraft["kind"]; label: string }[] = [
  { kind: "programs", label: "A number of programs" },
  { kind: "airtime", label: "About a set time" },
  { kind: "airtime_range", label: "A time within a range" },
];

/**
 * Suggests a marathon length when the owner turns marathons on: the
 * ordinary stretch's unit, and longer than its longest turn, as the server
 * requires; twice the programs, or three times the minutes.
 */
export function suggestMarathon(ordinary: StretchDraft): StretchDraft {
  if (ordinary.kind === "programs") {
    return { ...UNCHOSEN_STRETCH, count: (ordinary.count || 1) * 2 };
  }
  const longest =
    ordinary.kind === "airtime" ? ordinary.minutes : ordinary.maxMinutes;
  return { ...UNCHOSEN_STRETCH, kind: "airtime", minutes: (longest || 60) * 3 };
}

/**
 * Edits how long each of an assignment's turns runs, or, with `marathon`,
 * how long its marathon turns run, and explains that an airtime target
 * airs whole programs, so a turn runs over rather than cut a program short.
 */
export function StretchFields({
  draft,
  onChange,
  marathon = false,
}: {
  draft: StretchDraft;
  onChange: (draft: StretchDraft) => void;
  marathon?: boolean;
}) {
  const hintId = useId();
  // Names a field, as a marathon field when this edits a marathon.
  const name = (text: string) =>
    marathon ? `Marathon ${text.toLowerCase()}` : text;
  // A range's most may not fall below its least, so the browser points at
  // At most when it does; equal ends are allowed.
  const leastMost =
    Number.isSafeInteger(draft.minMinutes) && draft.minMinutes > 1
      ? draft.minMinutes
      : 1;
  // Edits one numeric field of the draft.
  const numberField = (
    label: string,
    field: "count" | "minutes" | "minMinutes" | "maxMinutes",
  ) => (
    <label>
      {name(label)}
      <input
        type="number"
        required
        min={field === "maxMinutes" ? leastMost : 1}
        step={1}
        value={Number.isNaN(draft[field]) ? "" : draft[field]}
        aria-describedby={draft.kind === "programs" ? undefined : hintId}
        onChange={(event) =>
          onChange({ ...draft, [field]: event.target.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <>
      <label>
        {name("Turn length")}
        <select
          value={draft.kind}
          onChange={(event) =>
            onChange({
              ...draft,
              kind: event.target.value as StretchDraft["kind"],
            })
          }
        >
          {KIND_CHOICES.map((choice) => (
            <option key={choice.kind} value={choice.kind}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {draft.kind === "programs" && numberField("Programs per turn", "count")}
      {draft.kind === "airtime" && numberField("Minutes per turn", "minutes")}
      {draft.kind === "airtime_range" && (
        <>
          {numberField("At least minutes", "minMinutes")}
          {numberField("At most minutes", "maxMinutes")}
        </>
      )}
      {draft.kind !== "programs" && !marathon && (
        <OverrunHint id={hintId} range={draft.kind === "airtime_range"} />
      )}
    </>
  );
}

/**
 * Explains that an airtime target airs whole programs, so a sitting runs
 * over rather than cut a program short; a range also picks one target.
 */
export function OverrunHint({ id, range }: { id: string; range: boolean }) {
  return (
    <small id={id} className="secondary">
      {range ? "Each turn picks one target in this range. " : ""}A turn airs
      whole programs until it reaches its target, so it runs over: 22-minute
      episodes against 60 minutes air 66, and a long movie airs whole.
    </small>
  );
}

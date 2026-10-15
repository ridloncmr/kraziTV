import { useId } from "react";

import type { StretchSetting } from "../http/contracts.js";

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

// Each turn length the editor offers.
const KIND_CHOICES: readonly { kind: StretchDraft["kind"]; label: string }[] = [
  { kind: "programs", label: "A number of programs" },
  { kind: "airtime", label: "About a set time" },
  { kind: "airtime_range", label: "A time within a range" },
];

/**
 * Edits how long each of an assignment's turns runs, and explains that an
 * airtime target airs whole programs, so a turn runs over rather than cut a
 * program short.
 */
export function StretchFields({
  draft,
  onChange,
}: {
  draft: StretchDraft;
  onChange: (draft: StretchDraft) => void;
}) {
  const hintId = useId();
  // Edits one numeric field of the draft.
  const numberField = (
    label: string,
    field: "count" | "minutes" | "minMinutes" | "maxMinutes",
  ) => (
    <label>
      {label}
      <input
        type="number"
        required
        min={1}
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
        Turn length
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
      {draft.kind !== "programs" && (
        <small id={hintId} className="secondary">
          {draft.kind === "airtime_range"
            ? "Each turn picks one target in this range. "
            : ""}
          A turn airs whole programs until it reaches its target, so it runs
          over: 22-minute episodes against 60 minutes air 66, and a long movie
          airs whole.
        </small>
      )}
    </>
  );
}

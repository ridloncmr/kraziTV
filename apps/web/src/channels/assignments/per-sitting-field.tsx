import { useId, useState } from "react";
import type { StretchSetting } from "../../http/contracts/programming.js";
import {
  isStretchComplete,
  OverrunHint,
  type StretchDraft,
  StretchFields,
  toStretchDraft,
  toStretchSetting,
} from "./stretch-fields.js";
import type { ContentKind } from "../contracts.js";
import { perSittingLabel } from "./stretch-words.js";

// Airtime presets every show offers beside its counts.
const AIRTIME_PRESETS: readonly StretchSetting[] = [30, 60, 120].map(
  (minutes) => ({ kind: "airtime", minutes }),
);

/**
 * The per-sitting presets for a show's content kind (programming spec
 * 0008): movies by count, episodes and everything else by count or
 * airtime. Each is an ordinary `StretchSetting`; only its words differ.
 */
function perSittingPresets(kind: ContentKind): readonly StretchSetting[] {
  if (kind === "movies") {
    return [1, 2, 3].map((count) => ({ kind: "programs", count }));
  }
  return [
    { kind: "programs", count: 1 },
    { kind: "programs", count: 3 },
    ...AIRTIME_PRESETS,
  ];
}

/**
 * Chooses how much of a show plays at a time from presets worded for its
 * content, or **Custom…** to reveal the stretch fields. A saved setting
 * that matches a preset shows as that preset and any other as Custom, so a
 * custom value round-trips. An unchosen draft asks for a choice, and the
 * select is required, so it blocks saving until one is made. A `hint`
 * explains the field beneath its select, where a roomy form has space.
 */
export function PerSittingField({
  draft,
  contentKind,
  hint,
  onChange,
}: {
  draft: StretchDraft;
  contentKind: ContentKind;
  hint?: string;
  onChange: (draft: StretchDraft) => void;
}) {
  const hintId = useId();
  const fieldHintId = useId();
  const presets = perSittingPresets(contentKind);
  const chosen = JSON.stringify(toStretchSetting(draft));
  const preset = presets.findIndex(
    (setting) => JSON.stringify(setting) === chosen,
  );
  // Custom stays open once chosen, even when its values reach a preset.
  const [customChosen, setCustomChosen] = useState(false);
  const custom = customChosen || (preset < 0 && isStretchComplete(draft));
  const overrun = !custom && preset >= 0 && draft.kind !== "programs";
  const describedBy = [hint && fieldHintId, overrun && hintId]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <label>
        Plays at a time
        <select
          required
          value={custom ? "custom" : preset < 0 ? "" : String(preset)}
          aria-describedby={describedBy || undefined}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "custom") {
              setCustomChosen(true);
              return;
            }
            const setting = presets[Number(value)];
            if (setting === undefined) return;
            setCustomChosen(false);
            onChange(toStretchDraft(setting));
          }}
        >
          <option value="" disabled>
            Choose…
          </option>
          {presets.map((setting, index) => (
            <option key={index} value={String(index)}>
              {perSittingLabel(setting, contentKind)}
            </option>
          ))}
          <option value="custom">{custom ? "Custom" : "Custom…"}</option>
        </select>
      </label>
      {hint && (
        <small id={fieldHintId} className="secondary">
          {hint}
        </small>
      )}
      {custom ? (
        <StretchFields draft={draft} onChange={onChange} />
      ) : (
        overrun && <OverrunHint id={hintId} range={false} />
      )}
    </>
  );
}

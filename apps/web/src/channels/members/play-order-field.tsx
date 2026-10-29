import { useId } from "react";
import type { PlaybackMode } from "../../http/contracts/programming.js";
import { PLAYBACK_MODE_CHOICES } from "./playback-mode-choices.js";

/**
 * Chooses the playback mode a show's collections play in. With `hint`, the
 * chosen mode's explanation shows beneath the select, where a roomy form
 * has space; a compact row leaves it out. Without `random`, Random is not
 * offered, for a collection that plays once from its beginning.
 */
export function PlayOrderField({
  mode,
  hint = false,
  random = true,
  onChange,
}: {
  mode: PlaybackMode;
  hint?: boolean;
  random?: boolean;
  onChange: (mode: PlaybackMode) => void;
}) {
  const hintId = useId();
  return (
    <>
      <label>
        Play order
        <select
          value={mode}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value as PlaybackMode)}
        >
          {PLAYBACK_MODE_CHOICES.filter(
            (choice) => random || choice.mode !== "random",
          ).map((choice) => (
            <option key={choice.mode} value={choice.mode}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {hint && (
        <small id={hintId} className="secondary">
          {PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === mode)?.hint}
        </small>
      )}
    </>
  );
}

import { useId, type ReactNode } from "react";

/**
 * A checkbox named by its label alone, with a description beneath the label
 * that assistive technology reads as the checkbox's description, so a long
 * explanation never becomes part of the control's name.
 */
export function CheckboxOption({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <label className="choice">
      <input
        type="checkbox"
        checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span id={labelId}>{label}</span>
      <small id={descriptionId} className="secondary">
        {description}
      </small>
    </label>
  );
}

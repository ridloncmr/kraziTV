import { useId, type ReactNode } from "react";

/**
 * A checkbox named by its label alone, with a description beneath the label
 * that assistive technology reads as the checkbox's description, so a long
 * explanation never becomes part of the control's name. Given a `radio`
 * group name it is one radio button of that group instead, which reports
 * only being chosen.
 */
export function CheckboxOption({
  label,
  description,
  checked,
  radio,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  /** The radio group's name, which makes this a radio button. */
  radio?: string;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <label className="choice">
      <input
        type={radio === undefined ? "checkbox" : "radio"}
        name={radio}
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

import type { MouseEvent } from "react";

/**
 * The XP property-sheet footer: OK, Cancel, and Apply at the bottom right.
 * OK and Apply are the form's submit buttons, so Enter in a field presses OK,
 * but each checks the form's required fields and then calls its handler
 * instead of submitting. Both stay disabled until a field changed, since
 * there is nothing to save, and every button waits out a pending save.
 */
export function SheetFooter({
  dirty,
  busy,
  onOk,
  onCancel,
  onApply,
}: {
  /** Whether a field holds a change not yet saved. */
  dirty: boolean;
  busy: boolean;
  /** Saves, then closes the sheet. */
  onOk: () => void;
  /** Closes the sheet, asking first when a change would be lost. */
  onCancel: () => void;
  /** Saves and leaves the sheet open. */
  onApply: () => void;
}) {
  const nothingToSave = !dirty || busy;
  return (
    <div className="dialog-actions">
      <button type="submit" disabled={nothingToSave} onClick={validThen(onOk)}>
        OK
      </button>
      <button type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={nothingToSave}
        onClick={validThen(onApply)}
      >
        Apply
      </button>
    </div>
  );
}

/** Runs `save` in place of the form's submit once the browser accepts its fields, which it points at otherwise. */
function validThen(save: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.currentTarget.form?.reportValidity() ?? true) save();
  };
}

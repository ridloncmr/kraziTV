import type { MouseEvent } from "react";

/**
 * The XP property-sheet footer: OK, Cancel, and Apply at the bottom right.
 * OK and Apply are the form's submit buttons, so Enter in a field presses OK,
 * but each checks the form's required fields and then calls its handler
 * instead of submitting. As on XP, OK is available except during a save: on an unchanged
 * sheet it just closes, through Cancel, which closes an unchanged sheet
 * without asking. Apply stays disabled until a field changed, since there is
 * nothing to save, and every button waits out a pending save. A sheet whose
 * draft the server would refuse on a check no field can show holds OK and
 * Apply too, pointing at the words that say what to change.
 */
export function SheetFooter({
  dirty,
  busy,
  held,
  onOk,
  onCancel,
  onApply,
}: {
  /** Whether a field holds a change not yet saved. */
  dirty: boolean;
  busy: boolean;
  /** The id of the words saying why saving is held, which disables OK and Apply until the draft is fixed. */
  held?: string;
  /** Saves, then closes the sheet. */
  onOk: () => void;
  /** Closes the sheet, asking first when a change would be lost; OK on an unchanged sheet uses it to close. */
  onCancel: () => void;
  /** Saves and leaves the sheet open. */
  onApply: () => void;
}) {
  const nothingToSave = !dirty || busy;
  return (
    <div className="dialog-actions">
      <button
        type="submit"
        disabled={busy || held !== undefined}
        aria-describedby={held}
        onClick={dirty ? validThen(onOk) : closeUnchanged(onCancel)}
      >
        OK
      </button>
      <button type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={nothingToSave || held !== undefined}
        aria-describedby={held}
        onClick={validThen(onApply)}
      >
        Apply
      </button>
    </div>
  );
}

/** Closes an unchanged sheet from OK without submitting the form, since nothing needs saving or checking. */
function closeUnchanged(close: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    close();
  };
}

/** Runs `save` in place of the form's submit once the browser accepts its fields, which it points at otherwise. */
function validThen(save: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.currentTarget.form?.reportValidity() ?? true) save();
  };
}

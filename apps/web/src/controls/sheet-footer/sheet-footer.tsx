import type { MouseEvent } from "react";

/**
 * The XP property-sheet footer: OK, Cancel, and Apply at the bottom right.
 * OK and Apply are the form's submit buttons, so Enter in a field presses OK,
 * but each checks the form's required fields and then calls its handler
 * instead of submitting. As on XP, OK is always available: on an unchanged
 * sheet it just closes, through Cancel, which closes an unchanged sheet
 * without asking. Apply stays disabled until a field changed, since there is
 * nothing to save, and every button waits out a pending save.
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
        disabled={busy}
        onClick={dirty ? validThen(onOk) : closeUnchanged(onCancel)}
      >
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

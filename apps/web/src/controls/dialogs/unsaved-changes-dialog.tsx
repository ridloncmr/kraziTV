import { WindowDialog } from "./window-dialog.js";

/**
 * Asks before closing something that holds unsaved changes, which closing
 * would lose silently: a window, or a sheet's Cancel. Keep editing is the
 * safe answer, so dismissing the question chooses it.
 */
export function UnsavedChangesDialog({
  name,
  onDiscard,
  onKeepEditing,
}: {
  /** What holds the changes, as the owner knows it. */
  name: string;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  return (
    <WindowDialog title="Unsaved changes" onClose={onKeepEditing}>
      <p>
        Discard your unsaved changes to <strong>{name}</strong>?
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onDiscard}>
          Discard changes
        </button>
        <button type="button" onClick={onKeepEditing}>
          Keep editing
        </button>
      </div>
    </WindowDialog>
  );
}

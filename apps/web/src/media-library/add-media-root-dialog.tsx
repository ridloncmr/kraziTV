import { formText } from "../controls/form-text.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { useMutation } from "../http/use-resource.js";

/**
 * Registers a server path as a media root; scanning stays a separate, explicit
 * action in the root list. The dialog owns its request, so a rejected path
 * stays beside the field instead of behind the dialog.
 */
export function AddMediaRootDialog({
  added,
  onClose,
}: {
  /** Called once the server registered the root; the list refreshes itself. */
  added: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  return (
    <WindowDialog
      title="Add media root"
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run(
            "/media-roots",
            "POST",
            { path: formText(new FormData(event.currentTarget), "path") },
            added,
          );
        }}
      >
        <label>
          Absolute server path
          <input
            name="path"
            required
            placeholder="C:\Media or /srv/media"
            disabled={mutation.pending}
          />
        </label>
        <RequestFeedback loading={mutation.pending} error={mutation.error} />
        <div className="dialog-actions">
          <button type="submit" disabled={mutation.pending}>
            Add root
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

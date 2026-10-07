import { formText } from "../controls/form-text.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import type { MediaCollection } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";

/**
 * Creates an empty, named collection; media are added afterward in the
 * collection editor. The dialog owns its request, so a rejection stays beside
 * the field instead of behind the dialog.
 */
export function CreateCollectionDialog({
  created,
  onClose,
}: {
  created: (collection: MediaCollection) => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  return (
    <WindowDialog
      title="New collection"
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run<MediaCollection>(
            "/media-collections",
            "POST",
            { name: formText(new FormData(event.currentTarget), "name") },
            created,
          );
        }}
      >
        <label>
          Collection name
          <input name="name" required disabled={mutation.pending} />
        </label>
        <RequestFeedback loading={mutation.pending} error={mutation.error} />
        <div className="dialog-actions">
          <button type="submit" disabled={mutation.pending}>
            Create collection
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

import { useEffect, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import { useMutation } from "../../http/use-resource.js";
import { CriterionPicker, type CriterionChoice } from "./criterion-picker.js";

/**
 * Creates an automatic collection: the owner picks what it matches, sees
 * the server's preview of its members in order, and confirms.
 */
export function NewAutomaticCollectionDialog({
  created,
  onClose,
}: {
  created: (collection: MediaCollection) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<CriterionChoice>();
  // Follows the chosen group until the owner types a name of their own.
  const [name, setName] = useState({ value: "", typed: false });
  const mutation = useMutation();
  const groupName = choice?.groupName ?? "";
  useEffect(() => {
    setName((current) =>
      current.typed ? current : { value: groupName, typed: false },
    );
  }, [groupName]);

  return (
    <WindowDialog
      title="New automatic collection"
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (choice === undefined) return;
          void mutation.run<MediaCollection>(
            "/media-collections",
            "POST",
            { name: name.value.trim(), criterion: choice.criterion },
            created,
          );
        }}
      >
        <CriterionPicker disabled={mutation.pending} onChoice={setChoice} />
        <label>
          Collection name
          <input
            value={name.value}
            required
            disabled={mutation.pending}
            onChange={(event) =>
              setName({ value: event.target.value, typed: true })
            }
          />
        </label>
        <RequestFeedback loading={mutation.pending} error={mutation.error} />
        <div className="dialog-actions">
          <button
            type="submit"
            disabled={!choice?.previewed || mutation.pending}
          >
            Create automatic collection
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

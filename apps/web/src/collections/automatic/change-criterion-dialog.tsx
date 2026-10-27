import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import { useMutation } from "../../http/resources/use-resource.js";
import { CriterionPicker, type CriterionChoice } from "./criterion-picker.js";

/**
 * Changes an automatic collection's criterion once the owner has seen the
 * resulting members: the preview applies the collection's exclusions, so it
 * shows exactly what applying commits. The name is left alone.
 */
export function ChangeCriterionDialog({
  path,
  collection,
  changed,
  onClose,
}: {
  path: string;
  collection: MediaCollection;
  changed: () => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<CriterionChoice>();
  const mutation = useMutation();
  return (
    <WindowDialog
      title="Change criterion"
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (choice === undefined) return;
          void mutation.run(
            path,
            "PATCH",
            { criterion: choice.criterion },
            changed,
          );
        }}
      >
        <CriterionPicker
          initialKind={collection.criterion?.kind}
          mediaCollectionId={collection.id}
          disabled={mutation.pending}
          onChoice={setChoice}
        />
        <p className="secondary">
          Exclusions stay. Channels programming from this collection update to
          the new members, finishing whatever is airing first.
        </p>
        <RequestFeedback loading={mutation.pending} error={mutation.error} />
        <div className="dialog-actions">
          <button
            type="submit"
            disabled={!choice?.previewed || mutation.pending}
          >
            Apply criterion
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

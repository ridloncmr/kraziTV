import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { useMutation } from "../../http/resources/use-resource.js";

/**
 * Confirms converting an automatic collection to manual. The dialog owns its
 * request, so a refusal stays beside the confirmation instead of behind it.
 */
export function ConvertToManualDialog({
  path,
  name,
  converted,
  onClose,
}: {
  path: string;
  name: string;
  converted: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  return (
    <WindowDialog
      title="Convert to manual"
      busy={mutation.pending}
      onClose={onClose}
    >
      <p>
        Convert <strong>{name}</strong> to a manual collection? It keeps its
        current members and their order, then changes only when you edit it:
        newly matching media no longer join, and its exclusions are cleared. It
        cannot become automatic again.
      </p>
      <RequestFeedback loading={mutation.pending} error={mutation.error} />
      <div className="dialog-actions">
        <button
          disabled={mutation.pending}
          onClick={() =>
            void mutation.run(`${path}/conversion`, "POST", undefined, () =>
              converted(),
            )
          }
        >
          Convert to manual collection
        </button>
        <button disabled={mutation.pending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </WindowDialog>
  );
}

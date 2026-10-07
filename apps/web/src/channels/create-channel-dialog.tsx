import { formText } from "../controls/form-text.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import type { Channel } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";

/**
 * Creates a channel from its identity alone; programming is assigned
 * afterward in the channel editor. The dialog owns its request, so a
 * rejection stays beside the fields instead of behind the dialog.
 */
export function CreateChannelDialog({
  created,
  onClose,
}: {
  created: (channel: Channel) => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  return (
    <WindowDialog title="New channel" busy={mutation.pending} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void mutation.run<Channel>(
            "/channels",
            "POST",
            {
              number: formText(values, "number"),
              name: formText(values, "name"),
            },
            created,
          );
        }}
      >
        <fieldset disabled={mutation.pending}>
          <legend>Channel identity</legend>
          <div className="inline-form">
            <label>
              Channel number
              <input name="number" required placeholder="69 or 69.1" />
            </label>
            <label>
              Channel name
              <input name="name" required />
            </label>
          </div>
        </fieldset>
        <RequestFeedback loading={mutation.pending} error={mutation.error} />
        <div className="dialog-actions">
          <button type="submit" disabled={mutation.pending}>
            Create channel
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

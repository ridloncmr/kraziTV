import { useState } from "react";
import { formText } from "../controls/form-text.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { useMutation } from "../http/use-resource.js";
import { FolderBrowser } from "./folder-browser.js";

/**
 * Registers a server path as a media root; scanning stays a separate, explicit
 * action in the root list. The dialog owns its request, so a rejected path
 * stays beside the field instead of behind the dialog. The path can be typed
 * or picked by browsing server folders; either way the field is what is sent.
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
  const [path, setPath] = useState("");
  // undefined while the browser is closed; null opens the top level.
  const [browsing, setBrowsing] = useState<string | null>();
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
        <div className="inline-form">
          <label>
            Absolute server path
            <input
              name="path"
              required
              placeholder="C:\Media or /srv/media"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              disabled={mutation.pending}
            />
          </label>
          <button
            type="button"
            aria-expanded={browsing !== undefined}
            disabled={mutation.pending}
            // Starts from the typed path so a UNC share or deep folder needs no clicking.
            onClick={() =>
              setBrowsing(
                browsing === undefined ? path.trim() || null : undefined,
              )
            }
          >
            Browse…
          </button>
        </div>
        {browsing !== undefined && (
          <FolderBrowser
            path={browsing}
            disabled={mutation.pending}
            onOpen={(folder) => {
              setBrowsing(folder);
              if (folder !== null) setPath(folder);
            }}
          />
        )}
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

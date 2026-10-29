import { useEffect, useRef, useState } from "react";
import { formText } from "../controls/formatting/form-text.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import { WindowDialog } from "../controls/dialogs/window-dialog.js";
import type { MediaRoot } from "../http/contracts/media.js";
import { useMutation } from "../http/resources/use-resource.js";
import { FolderBrowser } from "./folder-browser.js";

/** What `POST /media-roots` answers with; it carries no scan or match counts. */
type AddedRoot = Pick<MediaRoot, "id" | "path">;

/**
 * Registers a server path as a media root, then offers to scan it, so the
 * first run never stalls on finding Scan. The dialog owns its request, so a
 * rejected path stays beside the field instead of behind the dialog. The path
 * can be typed or picked by browsing server folders; either way the field is
 * what is sent. Once the server registered the root the form gives way to the
 * scan question; the root is kept whichever answer is given.
 */
export function AddMediaRootDialog({
  added,
  onScan,
  onClose,
}: {
  /** Called once the server registered the root; the list refreshes itself. */
  added: () => void;
  /** The owner chose to scan the added root now; the page starts the scan. */
  onScan: (root: AddedRoot) => void;
  /** Cancel, Not now, or closing: nothing further happens to the root. */
  onClose: () => void;
}) {
  const mutation = useMutation();
  const [path, setPath] = useState("");
  // undefined while the browser is closed; null opens the top level.
  const [browsing, setBrowsing] = useState<string | null>();
  // The registered root, once the form has done its job.
  const [addedRoot, setAddedRoot] = useState<AddedRoot>();
  return (
    <WindowDialog
      title="Add media root"
      busy={mutation.pending}
      onClose={onClose}
    >
      {addedRoot ? (
        <ScanPrompt
          root={addedRoot}
          onScan={() => onScan(addedRoot)}
          onDecline={onClose}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void mutation.run<AddedRoot>(
              "/media-roots",
              "POST",
              { path: formText(new FormData(event.currentTarget), "path") },
              (root) => {
                setAddedRoot(root);
                added();
              },
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
      )}
    </WindowDialog>
  );
}

/**
 * The question that follows a successful add. Scan takes focus, as XP wizards
 * put it on Finish, so Enter does the expected next thing; Not now leaves the
 * root listed with its Scan button for later.
 */
function ScanPrompt({
  root,
  onScan,
  onDecline,
}: {
  root: AddedRoot;
  onScan: () => void;
  onDecline: () => void;
}) {
  const scan = useRef<HTMLButtonElement>(null);
  useEffect(() => scan.current?.focus(), []);
  return (
    <>
      <p>{root.path} was added. Scan it now?</p>
      <div className="dialog-actions">
        <button ref={scan} onClick={onScan}>
          Scan
        </button>
        <button onClick={onDecline}>Not now</button>
      </div>
    </>
  );
}

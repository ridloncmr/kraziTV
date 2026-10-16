import { useState } from "react";

import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import type { UpcomingSelection } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import { UpcomingSelections } from "./programming-preview.js";

/**
 * Confirms restarting a channel's progress through one assigned collection
 * in its playback mode, then shows the selections the regenerated schedule
 * airs next. The dialog owns its request, so a refusal stays beside the
 * confirmation.
 */
export function ProgressResetDialog({
  path,
  mediaCollectionId,
  collectionName,
  modeLabel,
  upcoming,
  upcomingError,
  reset,
  onClose,
}: {
  path: string;
  /** The assigned collection whose progress restarts. */
  mediaCollectionId: string;
  collectionName: string;
  modeLabel: string;
  /** The collection's upcoming selections, refreshed by the owner after `reset`. */
  upcoming: UpcomingSelection[] | null;
  /** Why refreshing the upcoming selections failed, if it did. */
  upcomingError: Error | undefined;
  reset: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  // The list shown when the reset was confirmed; only a refetched list,
  // never this one, describes the regenerated schedule.
  const [before, setBefore] = useState<UpcomingSelection[] | null>();
  const done = before !== undefined;
  const refreshed = done && upcoming !== before ? upcoming : null;
  return (
    <WindowDialog
      title="Restart from the beginning"
      busy={mutation.pending}
      onClose={onClose}
    >
      {done ? (
        <>
          <p>
            {collectionName} restarts in {modeLabel.toLowerCase()} after what is
            airing now. Upcoming selections:
          </p>
          <RequestFeedback
            loading={refreshed === null && upcomingError === undefined}
            error={upcomingError}
          />
          {refreshed !== null && <UpcomingSelections selections={refreshed} />}
          <div className="dialog-actions">
            <button onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p>
            Restart <strong>{collectionName}</strong> in{" "}
            {modeLabel.toLowerCase()} from the beginning on this channel? What
            is airing now finishes; every later schedule entry is regenerated.
          </p>
          <RequestFeedback loading={mutation.pending} error={mutation.error} />
          <div className="dialog-actions">
            <button
              disabled={mutation.pending}
              onClick={() =>
                void mutation.run(path, "POST", { mediaCollectionId }, () => {
                  setBefore(upcoming);
                  reset();
                })
              }
            >
              Restart progress
            </button>
            <button disabled={mutation.pending} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </WindowDialog>
  );
}

import { useState } from "react";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import { WindowDialog } from "../../controls/dialogs/window-dialog.js";
import type {
  PlaybackMode,
  UpcomingSelection,
} from "../../http/contracts/programming.js";
import { useMutation } from "../../http/resources/use-resource.js";
import { playbackModeLabel } from "../members/playback-mode-choices.js";
import { UpcomingSelections } from "./programming-preview.js";

/**
 * Confirms restarting a channel's progress through one assigned collection
 * in its playback mode, then shows the selections the regenerated schedule
 * airs next. A random order has no beginning to go back to, so there the
 * reset is worded as a reshuffle: its picks start over in a new order, as
 * the server's reset gives the collection a new random seed. No sentence
 * builds a possessive from the name, which reads wrongly for names ending
 * in "s". The dialog owns its request, so a refusal stays beside the
 * confirmation.
 */
export function ProgressResetDialog({
  path,
  mediaCollectionId,
  collectionName,
  mode,
  upcoming,
  upcomingError,
  reset,
  onClose,
}: {
  path: string;
  /** The assigned collection whose progress restarts. */
  mediaCollectionId: string;
  collectionName: string;
  /** The saved playback mode whose progress restarts. */
  mode: PlaybackMode;
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
  const random = mode === "random";
  const modeWords = playbackModeLabel(mode).toLowerCase();
  return (
    <WindowDialog
      title={random ? "Reshuffle" : "Restart from the beginning"}
      busy={mutation.pending}
      onClose={onClose}
    >
      {done ? (
        <>
          <p>
            {random
              ? `${collectionName} plays in a new random order after what is airing now.`
              : `${collectionName} restarts in ${modeWords} after what is airing now.`}{" "}
            Upcoming selections:
          </p>
          <RequestFeedback
            loading={refreshed === null && upcomingError === undefined}
            error={upcomingError}
          />
          {refreshed !== null && <UpcomingSelections selections={refreshed} />}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          {random ? (
            <p>
              Reshuffle <strong>{collectionName}</strong> on this channel? Its
              random picks start over in a new order. What is airing now
              finishes; the schedule after it is rebuilt.
            </p>
          ) : (
            <p>
              Restart <strong>{collectionName}</strong> in {modeWords} from the
              beginning on this channel? What is airing now finishes; the
              schedule after it is rebuilt.
            </p>
          )}
          <RequestFeedback loading={mutation.pending} error={mutation.error} />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={mutation.pending}
              onClick={() =>
                void mutation.run(path, "POST", { mediaCollectionId }, () => {
                  setBefore(upcoming);
                  reset();
                })
              }
            >
              {random ? "Reshuffle" : "Restart progress"}
            </button>
            <button type="button" disabled={mutation.pending} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </WindowDialog>
  );
}

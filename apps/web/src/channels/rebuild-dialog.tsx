import { useState } from "react";

import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { resourcePath } from "../http/api-client.js";
import type { ProgrammingRebuild } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import { useCleanupRetries } from "./use-cleanup-retries.js";

// Shown in the dialog and kept on the cleanup retry My Channels lists.
const STOP_FAILED_MESSAGE =
  "The channel could not be stopped, so viewers may keep the old program until it ends.";

/**
 * Asks how to apply programming changes now: Let it finish, the default,
 * regenerates after the airing program and keeps rounds and cooldown; Stop
 * it now and rebuild the schedule interrupts the airing program and starts
 * a fresh programming slate, disconnecting viewers. One idempotency key per
 * dialog makes a resend repeat the same rebuild rather than start another.
 * A failed worker stop becomes a cleanup retry that outlives this dialog,
 * and a later rebuild whose stop succeeds settles any earlier one. After an
 * edit the server already applied, `finishApplied` makes Let it finish
 * confirm without regenerating again.
 */
export function RebuildDialog({
  channelId,
  rebuilt,
  onClose,
  finishApplied = false,
}: {
  channelId: string;
  /** Runs after either choice the server accepted. */
  rebuilt: () => void;
  onClose: () => void;
  finishApplied?: boolean;
}) {
  const mutation = useMutation();
  const cleanup = useCleanupRetries();
  const [choice, setChoice] = useState<"finish" | "rebuild">("finish");
  const [key] = useState(() => crypto.randomUUID());
  const [stopFailed, setStopFailed] = useState(false);
  const [done, setDone] = useState(false);
  const channelPath = resourcePath("channels", channelId);
  // Sends the chosen change; a rebuild repeats this dialog's one key.
  const submit = () => {
    if (choice === "finish" && finishApplied) {
      setDone(true);
      return;
    }
    if (choice === "finish") {
      void mutation.run(
        `${channelPath}/schedule/generate`,
        "POST",
        { regenerate: true },
        () => {
          setDone(true);
          rebuilt();
        },
      );
      return;
    }
    void mutation.run<ProgrammingRebuild>(
      `${channelPath}/programming/rebuild`,
      "POST",
      { idempotencyKey: key },
      (result) => {
        if (result.stopFailed) {
          cleanup.remember({
            id: channelId,
            operation: "rebuild",
            key,
            message: STOP_FAILED_MESSAGE,
          });
        } else {
          cleanup.settle(channelId, "rebuild");
        }
        setStopFailed(result.stopFailed);
        setDone(true);
        rebuilt();
      },
    );
  };
  return (
    <WindowDialog
      title="Rebuild the schedule"
      busy={mutation.pending}
      onClose={onClose}
    >
      {done ? (
        <>
          <p>
            {choice === "finish"
              ? "The schedule is rebuilt after what is airing now."
              : "The schedule is rebuilt from now with fresh programming."}
          </p>
          {stopFailed && (
            <p role="alert">
              {STOP_FAILED_MESSAGE} Retry the cleanup from the notice at the top
              of My Channels.
            </p>
          )}
          <div className="dialog-actions">
            <button onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <fieldset>
            <legend>What is airing now</legend>
            <label>
              <input
                type="radio"
                name="rebuild-choice"
                checked={choice === "finish"}
                onChange={() => setChoice("finish")}
              />
              Let it finish
            </label>
            <label>
              <input
                type="radio"
                name="rebuild-choice"
                checked={choice === "rebuild"}
                onChange={() => setChoice("rebuild")}
              />
              Stop it now and rebuild the schedule
            </label>
          </fieldset>
          <p>
            {choice === "finish"
              ? "The airing program finishes; later programming is rebuilt, and rounds and marathon cooldown carry on."
              : "Viewers watching now are disconnected and must tune in again. Rounds, marathon cooldown, and which member each assignment plays next start fresh; each collection keeps its place."}
          </p>
          <RequestFeedback loading={mutation.pending} error={mutation.error} />
          <div className="dialog-actions">
            <button disabled={mutation.pending} onClick={submit}>
              Rebuild
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

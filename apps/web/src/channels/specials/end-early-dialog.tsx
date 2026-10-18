import { useState } from "react";

import { displayTime } from "../../controls/display-time.js";
import { fromLocalInput } from "../../controls/local-instant.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { useMutation } from "../../http/use-resource.js";
import type { Special } from "./contracts.js";

/**
 * Ends a running special early, the only change it takes once it starts:
 * let the airing program finish, which ends the special with it, or stop it
 * now or at a chosen time, which cuts the program there (ADR 0015). Normal
 * programming follows either way. "Now" is the server's clock, so a browser
 * clock behind it never refuses the stop.
 */
export function EndEarlyDialog({
  special,
  path,
  ended,
  onClose,
}: {
  special: Special;
  /** The special's own path, which its end route hangs off. */
  path: string;
  ended: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  const [choice, setChoice] = useState<"finish" | "now" | "at">("finish");
  const [at, setAt] = useState("");
  // Sends the chosen end; the server checks it falls from now to the end.
  const submit = () => {
    const body =
      choice === "finish"
        ? { after: "airing" }
        : { endsAt: choice === "now" ? "now" : fromLocalInput(at) };
    void mutation.run(`${path}/end`, "POST", body, () => {
      ended();
      onClose();
    });
  };
  return (
    <WindowDialog
      title="End this special early"
      busy={mutation.pending}
      onClose={onClose}
    >
      <fieldset>
        <legend>What is airing now</legend>
        <label>
          <input
            type="radio"
            name="end-choice"
            checked={choice === "finish"}
            onChange={() => setChoice("finish")}
          />
          Let it finish
        </label>
        <label>
          <input
            type="radio"
            name="end-choice"
            checked={choice === "now"}
            onChange={() => setChoice("now")}
          />
          Stop it now
        </label>
        <label>
          <input
            type="radio"
            name="end-choice"
            checked={choice === "at"}
            onChange={() => setChoice("at")}
          />
          Stop it at
        </label>
        {choice === "at" && (
          <label>
            Ends at
            <input
              type="datetime-local"
              required
              value={at}
              onChange={(event) => setAt(event.target.value)}
            />
          </label>
        )}
      </fieldset>
      <p>
        {choice === "finish"
          ? "The program airing now finishes, the special ends with it, and normal programming follows."
          : "The program airing is cut there; viewers stay tuned and see normal programming follow."}
      </p>
      <RequestFeedback loading={mutation.pending} error={mutation.error} />
      <div className="dialog-actions">
        <button
          disabled={mutation.pending || (choice === "at" && at === "")}
          onClick={submit}
        >
          End special
        </button>
        <button disabled={mutation.pending} onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="secondary">
        Scheduled to end {displayTime(special.endsAt)}.
      </p>
    </WindowDialog>
  );
}

import { useContext } from "react";
import { createPortal } from "react-dom";
import { refusalWords } from "../http/refusal-words.js";
import { WindowStatusSlot } from "./window-status.js";

/**
 * Shared request feedback keeps validation, offline and pending states
 * visible in every program. Errors and messages sit where the request was
 * made. A refusal the web app has owner words for shows those words; any
 * other error shows its message, so nothing is silently lost. The pending
 * word goes to the window's status bar, where XP reported progress, so the
 * content never shifts while a read is in flight; outside a window it stays
 * in place.
 */
export function RequestFeedback({
  loading,
  error,
  message,
}: {
  loading?: boolean;
  error?: Error;
  message?: string;
}) {
  const slot = useContext(WindowStatusSlot);
  const working = loading && <p role="status">Working… Please wait.</p>;
  return (
    <div className="request-feedback" aria-live="polite">
      {working && slot ? createPortal(working, slot) : working}
      {error && (
        <p role="alert" className="error-message">
          {refusalWords(error) ?? error.message}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

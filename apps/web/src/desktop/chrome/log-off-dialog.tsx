import { useEffect, useId, useRef } from "react";
import { useMutation } from "../../http/use-resource.js";

/**
 * Confirms ending the session. It belongs to the desktop shell, not to a
 * program window, so it is modal over the whole desktop rather than a
 * window dialog. Focus starts on Log Off and returns to whatever had it
 * before, the Start button, when it closes. While the logout runs it cannot
 * close, because the server may already be ending the session.
 */
export function LogOffDialog({
  onCancel,
  onLoggedOff,
}: {
  onCancel: () => void;
  onLoggedOff: () => void;
}) {
  const logOff = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const logout = useMutation();
  useEffect(() => {
    // Captured before the effect below moves focus into the dialog.
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  useEffect(() => {
    // Log Off has focus whenever it can: at first, and again after a failed
    // logout, because disabling the pressed button dropped focus to the page,
    // where Escape would never reach this dialog.
    if (!logout.pending) logOff.current?.focus();
  }, [logout.pending]);
  return (
    <div className="log-off-layer">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="log-off-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (!logout.pending) onCancel();
        }}
      >
        <h2 id={titleId}>Log Off kraziTV</h2>
        <div className="log-off-choices">
          <button
            ref={logOff}
            type="button"
            className="log-off-choice"
            disabled={logout.pending}
            onClick={() =>
              void logout.run("/auth/logout", "POST", undefined, onLoggedOff)
            }
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <rect x="2" y="2" width="28" height="28" rx="6" />
              <path d="M13 9h-3v14h3M16 16h9m-4-4 4 4-4 4" />
            </svg>
            <span>Log Off</span>
          </button>
        </div>
        {logout.error && (
          <p role="alert" className="log-off-error">
            kraziTV couldn't log off. Check the connection and try again.
          </p>
        )}
        <div className="log-off-footer">
          <button type="button" disabled={logout.pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

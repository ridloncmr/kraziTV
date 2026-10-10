import { useEffect, useId, useRef, useState } from "react";
import {
  isReminderDue,
  snoozeReminder,
  stopReminder,
} from "./reminder-state.js";

const TITLE = "TMDB isn't set up";

/**
 * The system tray's TMDB icon and its balloon, shown while no key is set
 * (spec 0001, TMDB Setup Reminder). The balloon opens by itself once, when
 * the shell first knows there is media to enrich and the reminder is due;
 * the icon always reopens it. It never blocks a window.
 */
export function TmdbTrayReminder({
  configured,
  hasMediaRoots,
  onSetUp,
}: {
  /** Whether a key is set; undefined until the server answers. */
  configured: boolean | undefined;
  /** Whether a media root exists; undefined until the server answers. */
  hasMediaRoots: boolean | undefined;
  /** Opens Account Settings on the Set up TMDB task. */
  onSetUp: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Set only when the owner opens the balloon, so an automatic open never
  // takes focus from the window they are working in.
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const firstAction = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const decided = useRef(false);
  useEffect(() => {
    // Decide once per desktop start, after both answers arrive, so a later
    // refresh never reopens a balloon the owner just closed.
    if (decided.current || configured === undefined) return;
    if (hasMediaRoots === undefined) return;
    decided.current = true;
    if (!configured && hasMediaRoots && isReminderDue(Date.now()))
      setOpen(true);
  }, [configured, hasMediaRoots]);
  useEffect(() => {
    if (open && focusOnOpen) firstAction.current?.focus();
  }, [open, focusOnOpen]);

  if (configured !== false) {
    // A saved key closes the balloon, so removing the key later shows only
    // the icon; the balloon follows the stored choice again next start.
    if (open) setOpen(false);
    return null;
  }

  /** Closes the balloon after recording the owner's choice. */
  const close = (record: () => void) => {
    record();
    setOpen(false);
    setFocusOnOpen(false);
  };
  /** ✕ and Escape: the same as **Remind me later**. */
  const snooze = () => close(() => snoozeReminder(Date.now()));
  return (
    <div className="tmdb-tray">
      <button
        className="tmdb-tray-icon"
        title={TITLE}
        aria-label={TITLE}
        aria-expanded={open}
        onClick={() => {
          setFocusOnOpen(true);
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1 15 14H1Z" fill="#f5c400" stroke="#8a6d00" />
          <path d="M8 5.5v4.5M8 11.5v1.5" stroke="#000" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div
          className="tray-balloon"
          role="dialog"
          aria-label={TITLE}
          aria-describedby={bodyId}
          onKeyDown={(event) => {
            if (event.key === "Escape") snooze();
          }}
        >
          <button
            className="tray-balloon-close"
            aria-label="Close"
            onClick={snooze}
          >
            ✕
          </button>
          <strong>{TITLE}</strong>
          <p id={bodyId}>
            kraziTV can only read titles from file names. Set up TMDB to look up
            series, episodes, and movies.
          </p>
          <div className="tray-balloon-actions">
            <button
              ref={firstAction}
              onClick={() =>
                close(() => {
                  snoozeReminder(Date.now());
                  onSetUp();
                })
              }
            >
              Set up TMDB
            </button>
            <button onClick={snooze}>Remind me later</button>
            <button onClick={() => close(stopReminder)}>
              Don&apos;t remind me
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

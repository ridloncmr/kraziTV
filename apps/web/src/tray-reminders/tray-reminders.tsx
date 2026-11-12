import { useEffect, useId, useRef, useState } from "react";
import { Tooltip } from "../controls/popups/tooltip.js";
import type { TrayReminder } from "./contracts.js";
import { GreggFigure } from "./drawings/gregg-figure.js";
import { GreggHead } from "./drawings/gregg-head.js";
import {
  isReminderDue,
  snoozeReminder,
  stopReminder,
} from "./reminder-state.js";
import { BALLOON_WORDS } from "./tray-reminder-words.js";

/**
 * The system tray's one reminder icon, Gregg's head, and the one balloon it
 * opens (spec 0006, Tray reminders). The first reminder that shows leads:
 * the icon carries its title and opens its balloon. A reminder's balloon
 * opens by itself at most once per desktop start, the first time it leads
 * with its condition holding and its stored choice due, which may be
 * mid-session. It never blocks a window and never takes focus by itself.
 */
export function TrayReminders({
  reminders,
}: {
  /** Every reminder in the spec's order, as the shell evaluates them now. */
  reminders: readonly TrayReminder[];
}) {
  const lead = reminders.find((reminder) => reminder.shows);
  // The open balloon's reminder, and whether the owner asked for it, so
  // only a balloon they opened moves focus into itself.
  const [opened, setOpened] = useState<{ key: string; focus: boolean }>();
  // Reminders that have had their one automatic open this desktop start.
  const openedBySelf = useRef(new Set<string>());
  const firstAction = useRef<HTMLButtonElement>(null);
  const sentenceId = useId();
  const leadKey = lead?.storageKey;
  const leadHolds = lead?.holds === true;
  useEffect(() => {
    // Decided once per reminder, the first time it leads holding, so a
    // later refresh never reopens a balloon the owner closed.
    if (leadKey === undefined || !leadHolds) return;
    if (openedBySelf.current.has(leadKey)) return;
    openedBySelf.current.add(leadKey);
    if (isReminderDue(leadKey, Date.now()))
      setOpened((current) => current ?? { key: leadKey, focus: false });
  }, [leadKey, leadHolds]);
  useEffect(() => {
    if (opened?.focus) firstAction.current?.focus();
  }, [opened]);

  // A balloon whose reminder no longer leads closes unrecorded, so if it
  // leads again later only the icon returns.
  if (opened && opened.key !== leadKey) setOpened(undefined);
  if (!lead) return null;

  const { storageKey, words } = lead;
  const open = opened?.key === storageKey;
  /** Closes the balloon after recording the owner's choice for this reminder. */
  const close = (record: () => void) => {
    record();
    setOpened(undefined);
  };
  /** ✕ and Escape: the same as **Remind me later**. */
  const snooze = () => close(() => snoozeReminder(storageKey, Date.now()));
  return (
    <div className="tray-reminders">
      <Tooltip id="tray-reminder-tip" text={words.title} placement="above-end">
        <button
          className="tray-reminder-icon"
          aria-label={words.title}
          aria-expanded={open}
          onClick={() => setOpened({ key: storageKey, focus: true })}
        >
          <GreggHead />
        </button>
      </Tooltip>
      {open && (
        <div
          className="tray-balloon"
          role="dialog"
          aria-label={words.title}
          aria-describedby={sentenceId}
          onKeyDown={(event) => {
            if (event.key === "Escape") snooze();
          }}
        >
          <button
            className="tray-balloon-close"
            aria-label={BALLOON_WORDS.close}
            onClick={snooze}
          >
            ✕
          </button>
          <div className="tray-balloon-head">
            <span
              className="tray-balloon-gregg"
              role="img"
              aria-label={BALLOON_WORDS.assistant}
            >
              <GreggFigure />
            </span>
            <div>
              <strong>{words.title}</strong>
              <p className="tray-balloon-quip">{words.quip}</p>
            </div>
          </div>
          <p id={sentenceId}>{words.sentence}</p>
          <div className="tray-balloon-actions">
            <button
              ref={firstAction}
              onClick={() =>
                close(() => {
                  snoozeReminder(storageKey, Date.now());
                  lead.act();
                })
              }
            >
              {words.action}
            </button>
            <button onClick={snooze}>{BALLOON_WORDS.later}</button>
            <button onClick={() => close(() => stopReminder(storageKey))}>
              {BALLOON_WORDS.never}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { Tooltip } from "../controls/popups/tooltip.js";
import type { TrayReminder, TrayStatusWords } from "./contracts.js";
import { GreggFigure } from "./drawings/gregg-figure.js";
import { GreggHead } from "./drawings/gregg-head.js";
import {
  isReminderDue,
  recordCountSeen,
  remindAfterNew,
  snoozeReminder,
  stopReminder,
} from "./reminder-state.js";
import {
  BALLOON_WORDS,
  REMIND_AFTER_NEW_WORDS,
} from "./tray-reminder-words.js";

// The status balloon's key; no reminder's storage key is ever this.
const STATUS_KEY = "status";
// Remind me after's first number and its largest (spec 0006, Tray reminders).
const FIRST_AFTER_NEW = 5;
const MOST_AFTER_NEW = 99;

/**
 * The system tray's one reminder icon, Gregg's head, and the one balloon it
 * opens (spec 0006, Tray reminders). The first reminder that shows leads:
 * the icon carries its title and opens its balloon. A reminder's balloon
 * opens by itself at most once per desktop start, the first time it leads
 * with its condition holding and its stored choice due, which may be
 * mid-session. It never blocks a window and never takes focus by itself.
 * A reminder with a count also offers **Remind me after** a number of new
 * ones, counted from the fewest it has been seen with since. While no
 * reminder shows, a `status` such as running lookups takes the
 * icon: its balloon opens only when asked and has only ✕, with nothing to
 * answer or store.
 */
export function TrayReminders({
  reminders,
  status,
}: {
  /** Every reminder in the spec's order, as the shell evaluates them now. */
  reminders: readonly TrayReminder[];
  /** Work under way the owner can read about, or undefined when there is none. */
  status?: TrayStatusWords | undefined;
}) {
  const lead = reminders.find((reminder) => reminder.shows);
  // The open balloon's reminder, or the status, and whether the owner asked
  // for it, so only a balloon they opened moves focus into itself.
  const [opened, setOpened] = useState<{ key: string; focus: boolean }>();
  // Reminders that have had their one automatic open this desktop start.
  const openedBySelf = useRef(new Set<string>());
  // The button a balloon the owner opened focuses: its main action, or a
  // status's close.
  const focusOnOpen = useRef<HTMLButtonElement>(null);
  const sentenceId = useId();
  const leadKey = lead?.storageKey;
  const leadHolds = lead?.holds === true;
  const leadCount = lead?.count;
  useEffect(() => {
    // Decided once per reminder, the first time it leads holding, so a
    // later refresh never reopens a balloon the owner closed.
    if (leadKey === undefined || !leadHolds) return;
    if (openedBySelf.current.has(leadKey)) return;
    openedBySelf.current.add(leadKey);
    if (isReminderDue(leadKey, Date.now(), leadCount))
      setOpened((current) => current ?? { key: leadKey, focus: false });
  }, [leadKey, leadHolds, leadCount]);
  useEffect(() => {
    if (opened?.focus) focusOnOpen.current?.focus();
  }, [opened]);
  // Every known count as one value the effect below can follow. A count is
  // known only once the shell has read it for a settled library, so a guess
  // of 0 while files are left or a read is out never lowers what was seen.
  const counts = JSON.stringify(
    reminders.flatMap(({ storageKey, count }) =>
      count === undefined ? [] : [[storageKey, count]],
    ),
  );
  useEffect(() => {
    // Lowers each Remind me after answer's fewest seen whether or not its
    // reminder shows, since everything decided is when it falls furthest.
    for (const [storageKey, count] of JSON.parse(counts) as [string, number][])
      recordCountSeen(storageKey, count);
  }, [counts]);

  // What the icon carries: the leading reminder, else the status. The
  // status's key is fixed, so its balloon stays open as its count moves.
  const shownKey = lead ? leadKey : status && STATUS_KEY;
  const words = lead?.words ?? status;
  // A balloon whose reminder no longer leads closes unrecorded, so if it
  // leads again later only the icon returns.
  if (opened && opened.key !== shownKey) setOpened(undefined);
  if (shownKey === undefined || !words) return null;

  const open = opened?.key === shownKey;
  /** Closes the balloon after recording the owner's choice, if it has one. */
  const close = (record?: () => void) => {
    record?.();
    setOpened(undefined);
  };
  /** ✕ and Escape: the same as **Remind me later**; a status only closes. */
  const dismiss = () =>
    close(
      lead && (() => snoozeReminder(lead.storageKey, Date.now(), lead.count)),
    );
  return (
    <div className="tray-reminders">
      <Tooltip id="tray-reminder-tip" text={words.title} placement="above-end">
        <button
          className="tray-reminder-icon"
          aria-label={words.title}
          aria-expanded={open}
          onClick={() => setOpened({ key: shownKey, focus: true })}
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
            if (event.key === "Escape") dismiss();
          }}
        >
          <button
            // A status has no main action, so its close takes the focus.
            ref={lead ? undefined : focusOnOpen}
            className="tray-balloon-close"
            aria-label={BALLOON_WORDS.close}
            onClick={dismiss}
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
          {lead && (
            <div className="tray-balloon-actions">
              <button
                ref={focusOnOpen}
                onClick={() =>
                  close(() => {
                    snoozeReminder(lead.storageKey, Date.now(), lead.count);
                    lead.act();
                  })
                }
              >
                {lead.words.action}
              </button>
              <button onClick={dismiss}>{BALLOON_WORDS.later}</button>
              <button
                onClick={() => close(() => stopReminder(lead.storageKey))}
              >
                {BALLOON_WORDS.never}
              </button>
            </div>
          )}
          {lead && leadCount !== undefined && (
            <RemindAfterNew
              choose={(afterNew) =>
                close(() =>
                  remindAfterNew(lead.storageKey, afterNew, leadCount),
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Collections ready's **Remind me after** row (decision 24, amended): the
 * button, a number field, and "new ones". The button and Enter in the field
 * both choose it; a number outside 1 to 99, or not whole, is refused under
 * the row and nothing is chosen. The form skips the browser's own
 * validation, so its bubble never stands in for the balloon's words, and
 * Escape bubbles to the balloon, which closes as ✕ does. It mounts with
 * the balloon, so each open starts again at 5.
 */
function RemindAfterNew({
  choose,
}: {
  /** Records the number chosen and closes the balloon. */
  choose: (afterNew: number) => void;
}) {
  const [value, setValue] = useState(String(FIRST_AFTER_NEW));
  const [refused, setRefused] = useState(false);
  const refusalId = useId();
  return (
    <form
      className="tray-balloon-after"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // An emptied field reads as 0, which is refused like any other.
        const afterNew = Number(value);
        if (
          Number.isInteger(afterNew) &&
          afterNew >= 1 &&
          afterNew <= MOST_AFTER_NEW
        )
          choose(afterNew);
        else setRefused(true);
      }}
    >
      <div className="tray-balloon-after-row">
        <button type="submit">{REMIND_AFTER_NEW_WORDS.action}</button>
        <input
          type="number"
          min={1}
          max={MOST_AFTER_NEW}
          step={1}
          aria-label={REMIND_AFTER_NEW_WORDS.field}
          aria-invalid={refused}
          aria-describedby={refused ? refusalId : undefined}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setRefused(false);
          }}
        />
        <span>{REMIND_AFTER_NEW_WORDS.unit}</span>
      </div>
      {refused && (
        <p id={refusalId} role="alert" className="error-message">
          {REMIND_AFTER_NEW_WORDS.refusal}
        </p>
      )}
    </form>
  );
}

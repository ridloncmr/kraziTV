import { useId, useState } from "react";
import { CheckboxOption } from "../../controls/checkbox-option.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { TabbedPanel } from "../../controls/tabbed-panel.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { ProgrammingRule } from "../../http/contracts/programming.js";
import { useMutation } from "../../http/use-resource.js";
import {
  firstIncompleteTab,
  type RuleDraft,
  type RuleSourceChoice,
  type RuleTab,
  toRuleDraft,
  toRuleSettings,
} from "./rule-draft.js";
import { RuleShowsField } from "./rule-shows-field.js";
import { WEEKDAYS } from "./rule-words.js";

const TABS: readonly { key: RuleTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "when", label: "When" },
  { key: "shows", label: "Shows" },
];

/**
 * Adds or edits one programming rule in a window dialog laid out as an XP
 * property sheet: **General** names it and says what it does to the
 * lineup, **When** holds its calendar conditions in the server's
 * programming timezone, and **Shows** picks the shows it plays with any
 * sizes that apply only while it wins. Nothing writes until **OK**, which
 * first shows the tab of any missing field; the server validates the rest
 * and its message shows here. `saved` runs after a write it accepted.
 */
export function RuleDialog({
  path,
  rule,
  choices,
  timezone,
  saved,
  onClose,
}: {
  /** The rules collection for a new rule, or the rule's own path. */
  path: string;
  rule?: ProgrammingRule | undefined;
  choices: readonly RuleSourceChoice[];
  /** The server's programming timezone, once read. */
  timezone: string | undefined;
  saved: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  const tabsId = useId();
  const [tab, setTab] = useState<RuleTab>("general");
  const [draft, setDraft] = useState<RuleDraft>(() =>
    toRuleDraft(rule, choices),
  );
  // Every field edits through this, so a change never drops the rest.
  const edit = (change: Partial<RuleDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  return (
    <WindowDialog
      title={rule ? rule.name : "New rule"}
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const incomplete = firstIncompleteTab(draft);
          if (incomplete !== undefined) {
            // Shows the tab so the browser can point at the missing field.
            const form = event.currentTarget;
            setTab(incomplete);
            requestAnimationFrame(() => form.reportValidity());
            return;
          }
          void mutation.run(
            path,
            rule ? "PATCH" : "POST",
            toRuleSettings(draft),
            saved,
          );
        }}
      >
        <TabbedPanel
          label="Rule properties"
          idPrefix={`rule-${tabsId}`}
          tabs={TABS}
          selected={tab}
          onSelect={setTab}
        >
          <fieldset disabled={mutation.pending} className="form-stack">
            {tab === "general" && <GeneralFields draft={draft} edit={edit} />}
            {tab === "when" && (
              <WhenFields draft={draft} timezone={timezone} edit={edit} />
            )}
            {tab === "shows" && (
              <RuleShowsField
                choices={choices}
                sources={draft.sources}
                onChange={(sources) => edit({ sources })}
              />
            )}
          </fieldset>
        </TabbedPanel>
        <RequestFeedback
          loading={mutation.pending}
          error={mutation.error}
          message={mutation.message}
        />
        <div className="dialog-actions">
          <button type="submit" disabled={mutation.pending}>
            OK
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

/** The General tab: the rule's name, what it does to the lineup, and its priority. */
function GeneralFields({
  draft,
  edit,
}: {
  draft: RuleDraft;
  edit: (change: Partial<RuleDraft>) => void;
}) {
  const priorityHintId = useId();
  const behaviorId = useId();
  return (
    <>
      <label>
        Name
        <input
          required
          maxLength={80}
          placeholder="Christmas movies"
          value={draft.name}
          onChange={(event) => edit({ name: event.target.value })}
        />
      </label>
      <div
        role="radiogroup"
        aria-labelledby={behaviorId}
        className="field-group"
      >
        <span id={behaviorId}>While it applies</span>
        <CheckboxOption
          radio={`${behaviorId}-behavior`}
          label="Play its shows alongside the lineup"
          description="Its shows take turns with the lineup's regular rotation."
          checked={draft.behavior === "join"}
          onChange={() => edit({ behavior: "join" })}
        />
        <CheckboxOption
          radio={`${behaviorId}-behavior`}
          label="Play only its shows"
          description="The lineup pauses until the rule stops applying, then picks up where it left off."
          checked={draft.behavior === "feature"}
          onChange={() => edit({ behavior: "feature" })}
        />
      </div>
      <label>
        Priority
        <input
          type="number"
          required
          step={1}
          aria-describedby={priorityHintId}
          value={Number.isNaN(draft.priority) ? "" : draft.priority}
          onChange={(event) => edit({ priority: event.target.valueAsNumber })}
        />
      </label>
      <small id={priorityHintId} className="secondary">
        When rules overlap, the higher priority wins.
      </small>
    </>
  );
}

/**
 * The When tab: dates, weekdays, and hours, which combine. Leaving one
 * unset means it never limits the rule.
 */
function WhenFields({
  draft,
  timezone,
  edit,
}: {
  draft: RuleDraft;
  timezone: string | undefined;
  edit: (change: Partial<RuleDraft>) => void;
}) {
  const daysId = useId();
  const annual = draft.dateKind === "annual";
  return (
    <>
      {timezone && (
        <p className="secondary">
          Dates and times follow the server's programming timezone, {timezone},
          not this browser's.
        </p>
      )}
      <label>
        Dates
        <select
          value={draft.dateKind}
          onChange={(event) =>
            edit({
              dateKind: event.target.value as RuleDraft["dateKind"],
              start: "",
              end: "",
            })
          }
        >
          <option value="any">Any date</option>
          <option value="one_off">Between two dates</option>
          <option value="annual">Every year between two dates</option>
        </select>
      </label>
      {draft.dateKind !== "any" && (
        <div className="field-pair">
          <label>
            From
            <input
              type={annual ? "text" : "date"}
              required
              pattern={annual ? "\\d{2}-\\d{2}" : undefined}
              placeholder={annual ? "12-01" : undefined}
              title={annual ? "Month and day, as MM-DD" : undefined}
              value={draft.start}
              onChange={(event) => edit({ start: event.target.value })}
            />
          </label>
          <label>
            Through
            <input
              type={annual ? "text" : "date"}
              required
              pattern={annual ? "\\d{2}-\\d{2}" : undefined}
              placeholder={annual ? "12-31" : undefined}
              title={annual ? "Month and day, as MM-DD" : undefined}
              value={draft.end}
              onChange={(event) => edit({ end: event.target.value })}
            />
          </label>
          {annual && (
            <small className="secondary">
              Month and day, as MM-DD. A range like 12-20 through 01-05 runs
              over New Year.
            </small>
          )}
        </div>
      )}
      <div role="group" aria-labelledby={daysId} className="field-group">
        <span id={daysId}>Days</span>
        <div className="day-choices">
          {WEEKDAYS.map((day, index) => (
            <label key={day} className="choice">
              <input
                type="checkbox"
                checked={draft.weekdays.includes(index)}
                onChange={(event) =>
                  edit({
                    weekdays: event.target.checked
                      ? [...draft.weekdays, index].sort()
                      : draft.weekdays.filter((other) => other !== index),
                  })
                }
              />
              <span>{day}</span>
            </label>
          ))}
        </div>
        <small className="secondary">
          Leave every day unchecked for all week.
        </small>
      </div>
      <CheckboxOption
        label="Only during certain hours"
        description="Hours are checked between programs, so a program already airing finishes first."
        checked={draft.windowOn}
        onChange={(windowOn) => edit({ windowOn })}
      />
      {draft.windowOn && (
        <div className="field-pair">
          <label>
            Starts
            <input
              type="time"
              required
              value={draft.windowStart}
              onChange={(event) => edit({ windowStart: event.target.value })}
            />
          </label>
          <label>
            Ends
            <input
              type="time"
              required
              value={draft.windowEnd}
              onChange={(event) => edit({ windowEnd: event.target.value })}
            />
          </label>
          <small className="secondary">
            Hours that end before they start run past midnight and count as the
            day they started.
          </small>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { MarathonSettings } from "../../http/contracts/programming.js";
import {
  useMutation,
  type useResource,
} from "../../http/resources/use-resource.js";

/** The Occasional preset, which spec 0004 suggests when marathons first turn on. */
export const OCCASIONAL_MARATHONS: MarathonSettings = {
  marathonChancePercent: 10,
  marathonMinOrdinaryRounds: 2,
};

type Choice = "off" | "occasional" | "frequent" | "custom";

// The presets that set both values; Off keeps the saved cooldown.
const PRESETS: Record<"occasional" | "frequent", MarathonSettings> = {
  occasional: OCCASIONAL_MARATHONS,
  frequent: { marathonChancePercent: 25, marathonMinOrdinaryRounds: 1 },
};

/**
 * The Lineup's one channel-wide marathon control: Off, Occasional,
 * Frequent, or Custom… with a dialog for the chance and cooldown. A preset
 * saves at once; saved values that match none show as Custom, with
 * **Edit…** beside them, since choosing the option already shown opens
 * nothing. It is
 * disabled until some show allows marathons, since the chance would choose
 * nothing. `changed` runs after every save the server accepted.
 */
export function MarathonsControl({
  path,
  marathons,
  canMarathon,
  changed,
}: {
  path: string;
  marathons: ReturnType<typeof useResource<MarathonSettings>>;
  /** Whether some show in the lineup has a marathon length. */
  canMarathon: boolean;
  changed: () => void;
}) {
  const mutation = useMutation();
  const [customizing, setCustomizing] = useState(false);
  const saved = marathons.data;
  const isCustom = saved !== undefined && choiceOf(saved) === "custom";
  // Saves the settings, then reads them back for the lineup and Properties.
  const save = (settings: MarathonSettings, done?: () => void) =>
    void mutation.run(path, "PUT", settings, () => {
      marathons.refresh();
      changed();
      done?.();
    });
  return (
    <section aria-label="Marathons" className="inline-form">
      <label>
        Marathons
        <select
          disabled={!canMarathon || mutation.pending || !saved}
          value={saved ? choiceOf(saved) : "off"}
          onChange={(event) => {
            const choice = event.target.value as Choice;
            if (choice === "custom") setCustomizing(true);
            else if (choice === "off" && saved) {
              save({ ...saved, marathonChancePercent: 0 });
            } else if (choice !== "off") save(PRESETS[choice]);
          }}
        >
          <option value="off">Off</option>
          <option value="occasional">Occasional</option>
          <option value="frequent">Frequent</option>
          <option value="custom">{isCustom ? "Custom" : "Custom…"}</option>
        </select>
      </label>
      {isCustom && (
        <button
          type="button"
          aria-label="Edit custom marathons"
          disabled={!canMarathon || mutation.pending}
          onClick={() => setCustomizing(true)}
        >
          Edit…
        </button>
      )}
      {canMarathon ? (
        <p className="secondary">
          Each round may give one show that allows marathons a longer run. It
          resumes where that show left off; chance never guarantees one every
          day.
        </p>
      ) : (
        <p className="secondary">No show allows marathons yet.</p>
      )}
      <RequestFeedback
        loading={marathons.loading || mutation.pending}
        error={customizing ? undefined : (mutation.error ?? marathons.error)}
        message={mutation.message}
      />
      {customizing && saved && (
        <CustomMarathonsDialog
          saved={saved}
          busy={mutation.pending}
          error={mutation.error}
          save={(settings) => save(settings, () => setCustomizing(false))}
          onClose={() => setCustomizing(false)}
        />
      )}
    </section>
  );
}

/** Names the choice saved values match; any chance of zero is Off. */
function choiceOf(settings: MarathonSettings): Choice {
  if (settings.marathonChancePercent === 0) return "off";
  for (const choice of ["occasional", "frequent"] as const) {
    const preset = PRESETS[choice];
    if (
      preset.marathonChancePercent === settings.marathonChancePercent &&
      preset.marathonMinOrdinaryRounds === settings.marathonMinOrdinaryRounds
    ) {
      return choice;
    }
  }
  return "custom";
}

/**
 * Edits the channel's marathon chance and cooldown directly; nothing saves
 * until **OK**, and a refusal stays in the dialog beside its fields.
 */
function CustomMarathonsDialog({
  saved,
  busy,
  error,
  save,
  onClose,
}: {
  saved: MarathonSettings;
  busy: boolean;
  error: Error | undefined;
  save: (settings: MarathonSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(saved);
  // Edits one numeric field; an emptied box holds NaN, which blocks OK.
  const field = (label: string, key: keyof MarathonSettings, max?: number) => (
    <label>
      {label}
      <input
        type="number"
        required
        min={0}
        max={max}
        step={1}
        value={Number.isNaN(draft[key]) ? "" : draft[key]}
        onChange={(event) =>
          setDraft({ ...draft, [key]: event.target.valueAsNumber })
        }
      />
    </label>
  );
  return (
    <WindowDialog title="Custom marathons" busy={busy} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(draft);
        }}
      >
        {field("Chance per round (%)", "marathonChancePercent", 100)}
        {field(
          "Ordinary rounds between marathons",
          "marathonMinOrdinaryRounds",
        )}
        <RequestFeedback loading={busy} error={error} />
        <div className="dialog-actions">
          <button type="submit" disabled={busy}>
            OK
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

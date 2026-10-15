import { useEffect, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MarathonSettings } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";

// What spec 0004 suggests when marathons are first turned on.
const SUGGESTED: MarathonSettings = {
  marathonChancePercent: 10,
  marathonMinOrdinaryRounds: 2,
};

/**
 * Edits a channel's marathon chance and cooldown, shared by every
 * assignment. While the chance is zero and an assignment allows marathons,
 * it offers the suggested 10% and two ordinary rounds; `changed` runs after
 * a save the server accepted.
 */
export function MarathonSettingsForm({
  path,
  visible,
  marathonsAllowed,
  changed,
}: {
  path: string;
  visible: boolean;
  /** Whether some assignment has a marathon length to use. */
  marathonsAllowed: boolean;
  changed: () => void;
}) {
  const saved = useResource<MarathonSettings>(path, visible);
  const mutation = useMutation();
  const [draft, setDraft] = useState<MarathonSettings>();
  // Shows the saved settings until the owner edits them.
  useEffect(() => {
    if (saved.data && draft === undefined) setDraft(saved.data);
  }, [saved.data, draft]);
  if (draft === undefined) {
    return <RequestFeedback loading={saved.loading} error={saved.error} />;
  }
  return (
    <fieldset disabled={mutation.pending}>
      <legend>Marathons</legend>
      <RequestFeedback
        loading={mutation.pending}
        error={mutation.error}
        message={mutation.message}
      />
      <p className="secondary">
        Each round may give one assignment that allows marathons a longer turn.
        It resumes where that collection left off; chance never guarantees one
        every day.
      </p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run(path, "PUT", draft, () => {
            saved.refresh();
            changed();
          });
        }}
      >
        <label>
          Marathon chance per round (%)
          <input
            type="number"
            required
            min={0}
            max={100}
            step={1}
            value={draft.marathonChancePercent}
            onChange={(event) =>
              setDraft({
                ...draft,
                marathonChancePercent: event.target.valueAsNumber,
              })
            }
          />
        </label>
        <label>
          Ordinary rounds between marathons
          <input
            type="number"
            required
            min={0}
            step={1}
            value={draft.marathonMinOrdinaryRounds}
            onChange={(event) =>
              setDraft({
                ...draft,
                marathonMinOrdinaryRounds: event.target.valueAsNumber,
              })
            }
          />
        </label>
        {marathonsAllowed && draft.marathonChancePercent === 0 && (
          <button type="button" onClick={() => setDraft(SUGGESTED)}>
            Use the suggested 10% and two rounds
          </button>
        )}
        <button type="submit">Save marathon settings</button>
      </form>
    </fieldset>
  );
}

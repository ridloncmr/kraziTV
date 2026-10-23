import type { RuleMarathon } from "../../http/contracts/programming.js";
import { CheckboxOption } from "../../controls/checkbox-option.js";
import { PerSittingField } from "../assignments/per-sitting-field.js";
import {
  StretchFields,
  suggestMarathon,
} from "../assignments/stretch-fields.js";
import { perSittingLabel } from "../assignments/stretch-words.js";
import {
  newSource,
  type RuleSourceChoice,
  type SourceDraft,
} from "./rule-draft.js";

/**
 * The Rules dialog's What plays tab: every show in the lineup as a checkbox,
 * and under each checked one, how much plays at a time and its marathons
 * while the rule applies. Each show's sizes start as the lineup's, and
 * each checked show's settings form a group named for it, so its fields
 * never share a name with another show's.
 */
export function RuleShowsField({
  choices,
  sources,
  onChange,
}: {
  choices: readonly RuleSourceChoice[];
  sources: ReadonlyMap<string, SourceDraft>;
  onChange: (sources: Map<string, SourceDraft>) => void;
}) {
  // Replaces or removes one show's draft, keeping every other show's.
  const set = (assignmentId: string, source: SourceDraft | undefined) => {
    const next = new Map(sources);
    if (source === undefined) next.delete(assignmentId);
    else next.set(assignmentId, source);
    onChange(next);
  };
  return (
    <>
      <p className="secondary">
        Check what airs while this rule applies, series and movies alike.
        Anything marked Rules only stays out of the regular rotation and airs
        only when a rule picks it.
      </p>
      {sources.size === 0 && <p>Check at least one.</p>}
      <ul className="rule-shows">
        {choices.map((choice) => {
          const source = sources.get(choice.assignmentId);
          return (
            <li key={choice.assignmentId}>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={source !== undefined}
                  onChange={(event) =>
                    set(
                      choice.assignmentId,
                      event.target.checked ? newSource(choice) : undefined,
                    )
                  }
                />
                <span>
                  {choice.label}
                  {choice.ruleOnly && (
                    <span className="row-badge">Rules only</span>
                  )}
                </span>
              </label>
              {source !== undefined && (
                <div
                  role="group"
                  aria-label={`${choice.label} under this rule`}
                  className="rule-show-settings form-stack"
                >
                  <CheckboxOption
                    label="Change how much plays at a time"
                    description={`Otherwise ${perSittingLabel(choice.ordinaryStretch, choice.contentKind)} at a time, as in the lineup.`}
                    checked={source.ownLength}
                    onChange={(ownLength) =>
                      set(choice.assignmentId, { ...source, ownLength })
                    }
                  />
                  {source.ownLength && (
                    <PerSittingField
                      draft={source.ordinary}
                      contentKind={choice.contentKind}
                      onChange={(ordinary) =>
                        set(choice.assignmentId, { ...source, ordinary })
                      }
                    />
                  )}
                  <label>
                    Marathons
                    <select
                      value={source.marathonMode}
                      onChange={(event) =>
                        set(choice.assignmentId, {
                          ...source,
                          marathonMode: event.target
                            .value as RuleMarathon["mode"],
                          marathon: suggestMarathon(source.ordinary),
                        })
                      }
                    >
                      <option value="inherit">As set in the lineup</option>
                      <option value="disabled">
                        None while this rule applies
                      </option>
                      <option value="replace">Choose a marathon length</option>
                    </select>
                  </label>
                  {source.marathonMode === "replace" && (
                    <StretchFields
                      marathon
                      draft={source.marathon}
                      onChange={(marathon) =>
                        set(choice.assignmentId, { ...source, marathon })
                      }
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

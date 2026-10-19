import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  AssignmentSettings,
  SourceAssignment,
  StretchSuggestion,
} from "../../http/contracts/programming.js";
import { useMutation, useResourceMap } from "../../http/use-resource.js";
import {
  CollectionOrItemSearch,
  type FoundMember,
  memberKey,
} from "../../media-search/collection-or-item-search.js";
import { PerSittingField } from "../assignments/per-sitting-field.js";
import {
  isStretchComplete,
  type StretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "../assignments/stretch-fields.js";
import { perSittingLabel } from "../assignments/stretch-words.js";
import { suggestionPath } from "./show-draft.js";

/**
 * Adds several shows to a channel from one search over collections and
 * single items. Each checked result becomes its own show in normal
 * rotation, in collection order with the server's suggested per sitting
 * and marathons off (programming spec 0004); a collection with no
 * suggestion asks for per sitting before **Add** is enabled. **Add** sends
 * one all-or-nothing request, so a refusal adds nothing and keeps every
 * choice here, naming the show the server refused.
 */
export function AddShowsDialog({
  assignmentsPath,
  collections,
  unavailable,
  visible,
  changed,
  onClose,
}: {
  assignmentsPath: string;
  collections: MediaCollection[] | undefined;
  /** Members the lineup already plays, by member key, with why. */
  unavailable: ReadonlyMap<string, string>;
  visible: boolean;
  /** Runs after the server added the shows. */
  changed: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  const [picks, setPicks] = useState<FoundMember[]>([]);
  // Per sitting the owner chose for picks the server had no suggestion for.
  const [chosen, setChosen] = useState<ReadonlyMap<string, StretchDraft>>(
    new Map(),
  );
  const pathOf = (pick: FoundMember) => suggestionPath([pick.member]);
  const suggestions = useResourceMap<StretchSuggestion>(
    picks.filter((pick) => pick.member.kind === "collection").map(pathOf),
    visible,
  );
  // A pick's per sitting: one program for an item, else the suggestion, or
  // the owner's choice when there is none; undefined until it can be sent.
  const perSitting = (pick: FoundMember) => {
    if (pick.member.kind === "media_item") {
      return { kind: "programs", count: 1 } as const;
    }
    const suggested = suggestions.get(pathOf(pick))?.ordinaryStretch;
    if (suggested !== null) return suggested;
    const draft = chosen.get(memberKey(pick.member));
    return draft && isStretchComplete(draft)
      ? toStretchSetting(draft)
      : undefined;
  };
  const ready = picks.length > 0 && picks.every((pick) => perSitting(pick));
  // Names the refused show when the server says which one it was.
  const failure =
    mutation.error instanceof ApiError &&
    typeof mutation.error.details.index === "number"
      ? new Error(
          `${picks[mutation.error.details.index]?.name ?? "A show"} could not be added: ${mutation.error.message}`,
        )
      : mutation.error;
  return (
    <WindowDialog title="Add shows" busy={mutation.pending} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const assignments = picks.flatMap((pick): AssignmentSettings[] => {
            const ordinaryStretch = perSitting(pick);
            if (!ordinaryStretch) return [];
            return [
              {
                participation: "default",
                playbackMode:
                  pick.member.kind === "collection" ? "chronological" : null,
                ordinaryStretch,
                marathonStretch: null,
                members: [pick.member],
              },
            ];
          });
          void mutation.run<SourceAssignment[]>(
            `${assignmentsPath}/batch`,
            "POST",
            { assignments },
            () => {
              changed();
              onClose();
            },
          );
        }}
      >
        <fieldset disabled={mutation.pending}>
          <CollectionOrItemSearch
            collections={collections}
            checked={new Set(picks.map((pick) => memberKey(pick.member)))}
            unavailable={unavailable}
            visible={visible}
            onToggle={(found, checked) =>
              setPicks((current) =>
                checked
                  ? [...current, found]
                  : current.filter(
                      (pick) =>
                        memberKey(pick.member) !== memberKey(found.member),
                    ),
              )
            }
          />
          {picks.length > 0 && (
            <ol aria-label="Shows to add">
              {picks.map((pick) => {
                const key = memberKey(pick.member);
                const suggestion =
                  pick.member.kind === "collection"
                    ? suggestions.get(pathOf(pick))
                    : undefined;
                const setting = perSitting(pick);
                return (
                  <li key={key}>
                    <strong>{pick.name}</strong>{" "}
                    {pick.member.kind === "media_item" ? (
                      <small className="secondary">
                        Single item · once per sitting
                      </small>
                    ) : suggestion === undefined ? (
                      <small className="secondary">Checking its content…</small>
                    ) : suggestion.ordinaryStretch === null ? (
                      <span className="inline-form">
                        <PerSittingField
                          draft={chosen.get(key) ?? UNCHOSEN_STRETCH}
                          contentKind={suggestion.contentKind}
                          onChange={(draft) =>
                            setChosen((current) =>
                              new Map(current).set(key, draft),
                            )
                          }
                        />
                      </span>
                    ) : (
                      setting && (
                        <small className="secondary">
                          {perSittingLabel(setting, suggestion.contentKind)} per
                          sitting
                        </small>
                      )
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </fieldset>
        <RequestFeedback loading={mutation.pending} error={failure} />
        <div className="dialog-actions">
          <button type="submit" disabled={!ready || mutation.pending}>
            Add
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

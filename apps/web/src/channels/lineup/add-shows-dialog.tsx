import { useEffect, useId, useRef, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  AssignmentSettings,
  PlaybackMode,
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
import { PlayOrderField } from "../assignments/play-order-field.js";
import {
  isStretchComplete,
  type StretchDraft,
  toStretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "../assignments/stretch-fields.js";
import { suggestionPath } from "./show-draft.js";
import { joinShowNames, showLabel } from "./show-labels.js";

// How Add groups the picks: each its own show, or all in one wheel.
type Grouping = "separate" | "wheel";

// The dialog's two pages: choosing what to add, then how each show plays.
type Page = "pick" | "settings";

// The `chosen` key for the one wheel that holds every pick.
const WHEEL = "wheel";

// What the owner changed for one show before adding it; an unset field
// keeps collection order or the server's suggested per sitting.
type ShowChoice = { mode?: PlaybackMode; stretch?: StretchDraft };

/**
 * Adds shows to a channel from one picker that toggles between collections
 * and filterable single items. **Add as** says what the picks become: each
 * its own show, taking its own turns in normal rotation, or one wheel the
 * owner may name: a show whose picks share its turns, taking them one after
 * another in the order picked, as a broadcast wheel series does. **Next**
 * counts the picks so ones in the other view stay in sight, and opens a
 * second page boxing each show to add with its play order, collection
 * order unless changed, and its per sitting, the server's suggestion
 * unless changed; a show with no suggestion asks for per sitting before
 * **Add** is enabled. The pages are separate so a long result list never
 * pushes a show's settings out of sight. Marathons stay off and every show
 * plays in normal rotation (programming spec 0004), so those are left to
 * Properties. **Add** sends
 * one all-or-nothing request, so a refusal adds nothing and keeps every
 * choice here, naming the show the server refused.
 */
export function AddShowsDialog({
  assignmentsPath,
  collections,
  inLineup,
  visible,
  changed,
  onClose,
}: {
  assignmentsPath: string;
  collections: MediaCollection[] | undefined;
  /** Members the lineup already plays, by member key, left out of the results. */
  inLineup: ReadonlySet<string>;
  visible: boolean;
  /** Runs after the server added the shows. */
  changed: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  const nameHintId = useId();
  const [page, setPage] = useState<Page>("pick");
  const pageBody = useRef<HTMLDivElement>(null);
  // Moves focus to the shown page's first field, since the button that
  // turned the page is gone.
  useEffect(() => {
    pageBody.current
      ?.querySelector<HTMLElement>(":scope > :not([hidden]) :is(input, select)")
      ?.focus();
  }, [page]);
  const [picks, setPicks] = useState<FoundMember[]>([]);
  const [grouping, setGrouping] = useState<Grouping>("separate");
  const [name, setName] = useState("");
  // The shows' names as last sent, so a refusal names the show it refused
  // even after the owner changes the picks.
  const [sent, setSent] = useState<readonly string[]>([]);
  // What the owner changed for each show, by the show's key.
  const [chosen, setChosen] = useState<ReadonlyMap<string, ShowChoice>>(
    new Map(),
  );
  // The shows Add creates, each as the picks it plays.
  const shows =
    grouping === "wheel"
      ? picks.length > 0
        ? [picks]
        : []
      : picks.map((pick) => [pick]);
  const keyOf = (show: FoundMember[]) =>
    grouping === "wheel"
      ? WHEEL
      : show.map((pick) => memberKey(pick.member)).join();
  const membersOf = (show: FoundMember[]) => show.map((pick) => pick.member);
  const hasCollection = (show: FoundMember[]) =>
    show.some((pick) => pick.member.kind === "collection");
  const labelOf = (show: FoundMember[]) =>
    showLabel(
      grouping === "wheel" ? name.trim() || null : null,
      show.map((pick) => pick.name),
    );
  const pathOf = (show: FoundMember[]) => suggestionPath(membersOf(show));
  const suggestions = useResourceMap<StretchSuggestion>(
    shows.filter(hasCollection).map(pathOf),
    visible,
  );
  // A show's suggestion; a failed read counts as none, so the owner
  // chooses instead of waiting. Undefined while it is still being read.
  const suggestionFor = (show: FoundMember[]): StretchSuggestion | undefined =>
    suggestions.failed(pathOf(show))
      ? { ordinaryStretch: null, contentKind: null }
      : suggestions.get(pathOf(show));
  // Merges one change into what the owner chose for `show`.
  const choose = (show: FoundMember[], choice: ShowChoice) =>
    setChosen((current) =>
      new Map(current).set(keyOf(show), {
        ...current.get(keyOf(show)),
        ...choice,
      }),
    );
  const modeOf = (show: FoundMember[]) =>
    chosen.get(keyOf(show))?.mode ?? "chronological";
  // The per sitting a show's field shows: the owner's choice, else the
  // suggestion, else unchosen so the field asks for one.
  const stretchDraftOf = (show: FoundMember[]) => {
    const own = chosen.get(keyOf(show))?.stretch;
    if (own) return own;
    const suggested = suggestionFor(show)?.ordinaryStretch;
    return suggested ? toStretchDraft(suggested) : UNCHOSEN_STRETCH;
  };
  // A show's per sitting: one program for items alone, else its field's
  // draft once complete; undefined until it can be sent, including while
  // the suggestion is still being read.
  const perSitting = (show: FoundMember[]) => {
    if (!hasCollection(show)) return { kind: "programs", count: 1 } as const;
    if (suggestionFor(show) === undefined) return undefined;
    const draft = stretchDraftOf(show);
    return isStretchComplete(draft) ? toStretchSetting(draft) : undefined;
  };
  const ready = shows.length > 0 && shows.every((show) => perSitting(show));
  const refused = refusedShow(mutation.error, sent);
  const failure =
    refused && mutation.error
      ? new Error(`${refused} could not be added: ${mutation.error.message}`)
      : mutation.error;
  return (
    <WindowDialog title="Add shows" busy={mutation.pending} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (page === "pick") {
            if (picks.length > 0) setPage("settings");
            return;
          }
          const assignments = shows.flatMap((show): AssignmentSettings[] => {
            const ordinaryStretch = perSitting(show);
            if (!ordinaryStretch) return [];
            return [
              {
                name: grouping === "wheel" ? name.trim() || null : null,
                participation: "default",
                playbackMode: hasCollection(show) ? modeOf(show) : null,
                ordinaryStretch,
                marathonStretch: null,
                members: membersOf(show),
              },
            ];
          });
          setSent(shows.map(labelOf));
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
          <div ref={pageBody}>
            {/* Kept mounted while hidden, so Back returns to the same search. */}
            <div hidden={page !== "pick"}>
              <fieldset className="inline-form">
                <legend>Add as</legend>
                <label className="choice">
                  <input
                    type="radio"
                    name="add-as"
                    checked={grouping === "separate"}
                    onChange={() => setGrouping("separate")}
                  />
                  Separate shows
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="add-as"
                    checked={grouping === "wheel"}
                    onChange={() => setGrouping("wheel")}
                  />
                  A wheel
                </label>
              </fieldset>
              <p className="secondary">
                {grouping === "separate"
                  ? "Each pick becomes its own show and gets its own turns in the rotation."
                  : "The picks share one turn in the rotation and take it one after another, in the order picked, like the shows in NBC's Mystery Movie."}
              </p>
              {grouping === "wheel" && (
                <div className="form-stack">
                  <label>
                    Wheel name
                    <input
                      value={name}
                      maxLength={80}
                      placeholder={
                        picks.length > 0
                          ? joinShowNames(picks.map((pick) => pick.name))
                          : "Adult Animation"
                      }
                      aria-describedby={nameHintId}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <small id={nameHintId} className="secondary">
                    Optional. Leave blank to name the wheel after what it plays.
                  </small>
                </div>
              )}
              <CollectionOrItemSearch
                collections={collections}
                checked={new Set(picks.map((pick) => memberKey(pick.member)))}
                hidden={inLineup}
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
            </div>
            {page === "settings" && (
              <>
                <p>
                  Choose how each show plays. Marathons and rules are in each
                  show&apos;s Properties once it is added.
                </p>
                {shows.map((show) => {
                  const suggestion = suggestionFor(show);
                  return (
                    <fieldset key={keyOf(show)} className="show-settings">
                      <legend>{labelOf(show)}</legend>
                      {!hasCollection(show) ? (
                        <p className="secondary">
                          Plays one item each time it comes up.
                        </p>
                      ) : (
                        <>
                          <PlayOrderField
                            mode={modeOf(show)}
                            onChange={(mode) => choose(show, { mode })}
                          />
                          {suggestion === undefined ? (
                            <p className="secondary">Checking what it plays…</p>
                          ) : (
                            <PerSittingField
                              draft={stretchDraftOf(show)}
                              contentKind={suggestion.contentKind}
                              onChange={(stretch) => choose(show, { stretch })}
                            />
                          )}
                        </>
                      )}
                    </fieldset>
                  );
                })}
              </>
            )}
          </div>
        </fieldset>
        <RequestFeedback loading={mutation.pending} error={failure} />
        <div className="dialog-actions">
          {page === "pick" ? (
            <button type="submit" disabled={picks.length === 0}>
              {picks.length === 0 ? "Next" : `Next (${picks.length})`}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={mutation.pending}
                onClick={() => setPage("pick")}
              >
                Back
              </button>
              <button type="submit" disabled={!ready || mutation.pending}>
                {grouping === "wheel"
                  ? `Add wheel (${picks.length})`
                  : `Add (${picks.length})`}
              </button>
            </>
          )}
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

/**
 * Names the show a refused batch names: by the refusal's `index`, or, for a
 * request the server's validation refused, by the `assignments[N]` path its
 * message cites.
 */
function refusedShow(
  error: Error | undefined,
  sent: readonly string[],
): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const index =
    typeof error.details.index === "number"
      ? error.details.index
      : Number(/assignments\[(\d+)\]/.exec(error.message)?.[1]);
  return Number.isInteger(index) ? sent[index] : undefined;
}

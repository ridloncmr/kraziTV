import { useEffect, useId, useRef, useState } from "react";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import { WindowDialog } from "../../controls/dialogs/window-dialog.js";
import type { ProgramId } from "../../desktop/contracts.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  SourceAssignment,
  StretchSuggestion,
} from "../../http/contracts/programming.js";
import { refusalWords, refusedFields } from "../../http/refusal-words.js";
import {
  useMutation,
  useResourceMap,
} from "../../http/resources/use-resource.js";
import {
  CollectionOrItemSearch,
  type FoundMember,
  memberKey,
} from "../../media-search/collection-or-item-search.js";
import { PerSittingField } from "../stretch/per-sitting-field.js";
import { PlayOrderField } from "../members/play-order-field.js";
import {
  type Grouping,
  type PickedShow,
  pickedShows,
  type ShowChoice,
  suggestionPaths,
  toAssignments,
  unfinishedWords,
} from "./picks/picked-shows.js";
import { SelectedPicks } from "./picks/selected-picks.js";
import { joinShowNames } from "./picks/show-labels.js";

// The dialog's two pages: choosing what to add, then how each show plays.
type Page = "pick" | "settings";

/**
 * Adds shows to a channel from one picker that toggles between collections
 * and filterable single items. The search leads, so the first visit is
 * about picking; **Add as** appears under it only once two or more picks
 * could be grouped, and says what they become: each its own show, taking
 * its own turns in normal rotation, or one wheel the owner may name: a show
 * whose picks share its turns, taking them one after another in the order
 * picked, as a broadcast wheel series does. A lone pick is always its own
 * show, whatever was chosen while there were more. **Next**
 * counts the picks so ones in the other view stay in sight, and opens a
 * second page boxing each show to add with its play order, collection
 * order unless changed, and its per sitting, the server's suggestion
 * unless changed. A show with no suggestion, or with an incomplete or
 * backwards custom per sitting, keeps **Add** disabled, and the words
 * beside it name every such show and what to fix, since its box may be
 * scrolled out of sight. Under the search a counted
 * list keeps every pick in sight, whatever the search shows. The pages are
 * separate so a long result list never pushes a show's settings out of
 * sight. Marathons stay off and every show plays in normal rotation
 * (programming spec 0004), so those are left to Properties. **Add** sends
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
  openProgram,
}: {
  assignmentsPath: string;
  collections: MediaCollection[] | undefined;
  /** Members the lineup already plays, by member key, left out of the results. */
  inLineup: ReadonlySet<string>;
  visible: boolean;
  /** Runs after the server added the shows. */
  changed: () => void;
  onClose: () => void;
  /** Opens another program, which the picker needs for Media Library. */
  openProgram: (id: ProgramId) => void;
}) {
  const mutation = useMutation();
  const nameHintId = useId();
  const unchosenId = useId();
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
  // Removes one pick, from its result's checkbox or the selected list.
  const drop = (found: FoundMember) =>
    setPicks((current) =>
      current.filter(
        (pick) => memberKey(pick.member) !== memberKey(found.member),
      ),
    );
  const [chosenGrouping, setGrouping] = useState<Grouping>("separate");
  // One pick is its own show; the wheel choice waits for a second pick.
  const grouping: Grouping = picks.length >= 2 ? chosenGrouping : "separate";
  const [name, setName] = useState("");
  // The shows' names as last sent, so a refusal names the show it refused
  // even after the owner changes the picks.
  const [sent, setSent] = useState<readonly string[]>([]);
  // What the owner changed for each show, by the show's key.
  const [chosen, setChosen] = useState<ReadonlyMap<string, ShowChoice>>(
    new Map(),
  );
  const suggestions = useResourceMap<StretchSuggestion>(
    suggestionPaths(picks, grouping),
    visible,
  );
  const shows = pickedShows(picks, { grouping, name, chosen, suggestions });
  // Merges one change into what the owner chose for `show`.
  const choose = (show: PickedShow, choice: ShowChoice) =>
    setChosen((current) =>
      new Map(current).set(show.key, { ...current.get(show.key), ...choice }),
    );
  // Add stays disabled until every show can be sent, including while a
  // suggestion is still being read.
  const ready = shows.every((show) => show.problem === null);
  const toFix = unfinishedWords(shows);
  const refused = refusedShow(mutation.error, sent);
  // Names the show a refusal is about before its shared words, else the
  // server's message, so nothing is silently lost.
  const failure =
    refused && mutation.error
      ? new Error(
          `${refused} could not be added: ${refusalWords(mutation.error) ?? mutation.error.message}`,
        )
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
          // A disabled Add already stops a click and Enter; this refuses
          // any other submit, so an incomplete batch is never sent.
          if (!ready) return;
          const assignments = toAssignments(shows);
          setSent(shows.map((show) => show.label));
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
              <CollectionOrItemSearch
                collections={collections}
                checked={new Set(picks.map((pick) => memberKey(pick.member)))}
                hidden={inLineup}
                visible={visible}
                openProgram={openProgram}
                onToggle={(found, checked) =>
                  checked
                    ? setPicks((current) => [...current, found])
                    : drop(found)
                }
              />
              <SelectedPicks picks={picks} onRemove={drop} />
              {picks.length >= 2 && (
                <>
                  <fieldset className="inline-form">
                    <legend>Add as</legend>
                    <label className="choice">
                      <input
                        type="radio"
                        name="add-as"
                        checked={chosenGrouping === "separate"}
                        onChange={() => setGrouping("separate")}
                      />
                      Separate shows
                    </label>
                    <label className="choice">
                      <input
                        type="radio"
                        name="add-as"
                        checked={chosenGrouping === "wheel"}
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
                          placeholder={joinShowNames(
                            picks.map((pick) => pick.name),
                          )}
                          aria-describedby={nameHintId}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <small id={nameHintId} className="secondary">
                        Optional. Leave blank to name the wheel after what it
                        plays.
                      </small>
                    </div>
                  )}
                </>
              )}
            </div>
            {page === "settings" && (
              <>
                <p>
                  Choose how each show plays. Marathons and rules are in each
                  show&apos;s Properties once it is added.
                </p>
                {shows.map((show) => (
                  <fieldset key={show.key} className="show-settings">
                    <legend>{show.label}</legend>
                    {!show.hasCollection ? (
                      <p className="secondary">
                        Plays one item each time it comes up.
                      </p>
                    ) : (
                      <>
                        <PlayOrderField
                          mode={show.mode}
                          onChange={(mode) => choose(show, { mode })}
                        />
                        {show.suggestion === undefined ? (
                          <p className="secondary">Checking what it plays…</p>
                        ) : (
                          <PerSittingField
                            draft={show.draft}
                            contentKind={show.suggestion.contentKind}
                            onChange={(stretch) => choose(show, { stretch })}
                          />
                        )}
                      </>
                    )}
                  </fieldset>
                ))}
              </>
            )}
          </div>
        </fieldset>
        <RequestFeedback loading={mutation.pending} error={failure} />
        {page === "settings" && toFix !== undefined && (
          <p id={unchosenId} className="secondary">
            {toFix}
          </p>
        )}
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
              <button
                type="submit"
                disabled={!ready || mutation.pending}
                aria-describedby={toFix !== undefined ? unchosenId : undefined}
              >
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
 * request the server's validation refused, by the `assignments[N]` path of
 * the first field its details cite.
 */
function refusedShow(
  error: Error | undefined,
  sent: readonly string[],
): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const cited = refusedFields(error)
    .map((field) => /^assignments\[(\d+)\]/.exec(field.path)?.[1])
    .find((match) => match !== undefined);
  const index =
    typeof error.details.index === "number"
      ? error.details.index
      : Number(cited);
  return Number.isInteger(index) ? sent[index] : undefined;
}

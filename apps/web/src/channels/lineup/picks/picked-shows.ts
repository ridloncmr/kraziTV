import { displayCount } from "../../../controls/formatting/display-count.js";
import type {
  AssignmentMember,
  AssignmentSettings,
  PlaybackMode,
  StretchSetting,
  StretchSuggestion,
} from "../../../http/contracts/programming.js";
import {
  type FoundMember,
  memberKey,
} from "../../../media-search/collection-or-item-search.js";
import {
  type StretchDraft,
  type StretchProblem,
  stretchProblem,
  toStretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "../../stretch/stretch-fields.js";
import { suggestionPath } from "../show-draft.js";
import { listNames, showLabel } from "./show-labels.js";

/** How Add groups the picks: each its own show, or all in one wheel. */
export type Grouping = "separate" | "wheel";

/**
 * What the owner changed for one show before adding it; an unset field
 * keeps collection order or the server's suggested per sitting.
 */
export interface ShowChoice {
  mode?: PlaybackMode;
  stretch?: StretchDraft;
}

/** How the picks become shows, and what the owner chose for each. */
export interface PickedShowInputs {
  grouping: Grouping;
  /** The wheel's name as typed; blank names it by its picks. */
  name: string;
  /** What the owner changed for each show, by the show's key. */
  chosen: ReadonlyMap<string, ShowChoice>;
  /** The per-sitting suggestions read so far, by suggestion path. */
  suggestions: {
    get: (path: string) => StretchSuggestion | undefined;
    failed: (path: string) => boolean;
  };
}

/** One show Add creates, as its box on the settings page and its request read it. */
export interface PickedShow {
  /** The key the owner's choices for this show are kept under. */
  key: string;
  /** The owner's name for the show, or null to name it by its picks. */
  name: string | null;
  label: string;
  members: AssignmentMember[];
  /** Items alone play one a sitting, so they take no play order or per sitting. */
  hasCollection: boolean;
  mode: PlaybackMode;
  /** The server's suggestion, undefined while it is still being read. */
  suggestion: StretchSuggestion | undefined;
  /** The per sitting its field shows. */
  draft: StretchDraft;
  /** The per sitting Add sends, undefined until the show can be sent. */
  perSitting: StretchSetting | undefined;
  /** Why the show cannot be sent yet, or null when it can. */
  problem: "checking" | StretchProblem | null;
}

// The `chosen` key for the one wheel that holds every pick.
const WHEEL = "wheel";

// What a lone item plays each time its show comes up.
const ONE_ITEM: StretchSetting = { kind: "programs", count: 1 };

/**
 * The paths of the suggestions the picks' shows need read: one per show
 * that plays a collection, since items alone always play one a sitting.
 */
export function suggestionPaths(
  picks: readonly FoundMember[],
  grouping: Grouping,
): string[] {
  return groupPicks(picks, grouping).flatMap((show) =>
    hasCollection(show)
      ? [suggestionPath(show.map((pick) => pick.member))]
      : [],
  );
}

/**
 * The shows Add creates from the picks, each with what its box shows and
 * what Add sends. A failed suggestion read counts as no suggestion, so the
 * owner chooses instead of waiting. A show's per sitting is the owner's
 * choice, else the suggestion, else unchosen so its field asks for one; it
 * can be sent once complete.
 */
export function pickedShows(
  picks: readonly FoundMember[],
  { grouping, name, chosen, suggestions }: PickedShowInputs,
): PickedShow[] {
  const wheelName = grouping === "wheel" ? name.trim() || null : null;
  return groupPicks(picks, grouping).map((show): PickedShow => {
    const members = show.map((pick) => pick.member);
    const key =
      grouping === "wheel" ? WHEEL : members.map((m) => memberKey(m)).join();
    const own = chosen.get(key);
    const base = {
      key,
      name: wheelName,
      label: showLabel(
        wheelName,
        show.map((pick) => pick.name),
      ),
      members,
      mode: own?.mode ?? "chronological",
    };
    if (!hasCollection(show)) {
      return {
        ...base,
        hasCollection: false,
        suggestion: undefined,
        draft: UNCHOSEN_STRETCH,
        perSitting: ONE_ITEM,
        problem: null,
      };
    }
    const path = suggestionPath(members);
    const suggestion: StretchSuggestion | undefined = suggestions.failed(path)
      ? { ordinaryStretch: null, contentKind: null }
      : suggestions.get(path);
    const suggested = suggestion?.ordinaryStretch;
    const draft =
      own?.stretch ??
      (suggested ? toStretchDraft(suggested) : UNCHOSEN_STRETCH);
    const problem =
      suggestion === undefined ? "checking" : stretchProblem(draft);
    return {
      ...base,
      hasCollection: true,
      suggestion,
      draft,
      perSitting: problem === null ? toStretchSetting(draft) : undefined,
      problem,
    };
  });
}

/**
 * Says which shows' per sitting the owner must still choose or fix, by
 * what is wrong, so a disabled Add always says why even when the field is
 * out of sight. Undefined when nothing needs fixing, and while any
 * suggestion is still being read, since those fields have not appeared.
 */
export function unfinishedWords(
  shows: readonly PickedShow[],
): string | undefined {
  if (shows.some((show) => show.problem === "checking")) return undefined;
  const labels = (problem: StretchProblem) =>
    shows.filter((show) => show.problem === problem).map((show) => show.label);
  const unchosen = labels("incomplete");
  const backwards = labels("backwards");
  const words = [
    unchosen.length > 0 &&
      `Choose how much plays at a time for ${whichShows(unchosen)}.`,
    backwards.length > 0 &&
      `Make At most minutes no less than At least minutes for ${whichShows(backwards)}.`,
  ].filter(Boolean);
  return words.length > 0 ? words.join(" ") : undefined;
}

/**
 * The batch Add sends: every show that can be sent, each playing in normal
 * rotation with marathons off, as programming spec 0004 leaves those to
 * Properties.
 */
export function toAssignments(
  shows: readonly PickedShow[],
): AssignmentSettings[] {
  return shows.flatMap((show): AssignmentSettings[] =>
    show.perSitting === undefined
      ? []
      : [
          {
            name: show.name,
            participation: "default",
            playbackMode: show.hasCollection ? show.mode : null,
            ordinaryStretch: show.perSitting,
            marathonStretch: null,
            members: show.members,
          },
        ],
  );
}

// The shows Add creates, each as the picks it plays: one per pick, or one
// wheel holding every pick.
function groupPicks(
  picks: readonly FoundMember[],
  grouping: Grouping,
): FoundMember[][] {
  if (grouping === "separate") return picks.map((pick) => [pick]);
  return picks.length > 0 ? [[...picks]] : [];
}

// Whether a show plays a collection, so it takes a play order and per sitting.
function hasCollection(show: readonly FoundMember[]): boolean {
  return show.some((pick) => pick.member.kind === "collection");
}

// Names the shows a per-sitting request is for, counting them when there
// are several, since a long list names only the first two.
function whichShows(names: readonly string[]): string {
  return names.length === 1
    ? (names[0] ?? "")
    : `${displayCount(names.length)} shows: ${listNames(names)}`;
}

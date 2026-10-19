import { useEffect, useMemo, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import {
  optionValue,
  type CatalogOption,
} from "../../catalog-options/catalog-option.js";
import type {
  CollectionCriterion,
  CollectionMember,
} from "../../http/contracts/collections.js";
import { useResource } from "../../http/use-resource.js";
import { ReadOnlyMembers } from "../editor/read-only-members.js";

type Kind = CollectionCriterion["kind"];

/**
 * What each criterion kind lists, how it is labelled, how its members are
 * counted, and how a listed row's option value becomes a criterion.
 */
const KINDS: Record<
  Kind,
  {
    label: string;
    /** The picker's own label, distinct from the kind's radio button. */
    pick: string;
    path: string;
    criterion: (value: string) => CollectionCriterion;
    choose: string;
    explain: string;
    empty: string;
    unit: [string, string];
  }
> = {
  series: {
    label: "TV series",
    pick: "Series",
    path: "/media-collections/series",
    criterion: (value) => ({ kind: "series", tmdbId: Number(value) }),
    choose: "Choose a series",
    explain:
      "The collection keeps every cataloged episode, in season and episode order, as your catalog changes.",
    empty:
      "No TV series are cataloged yet. A series appears here once TMDB matches its episodes.",
    unit: ["episode", "episodes"],
  },
  franchise: {
    label: "Movie franchise",
    pick: "Franchise",
    path: "/media-collections/franchises",
    criterion: (value) => ({ kind: "franchise", tmdbId: Number(value) }),
    choose: "Choose a franchise",
    explain:
      "The collection keeps every cataloged movie of the franchise, in release order, as your catalog changes.",
    empty:
      "No movie franchises are cataloged yet. A franchise appears here once TMDB matches one of its movies.",
    unit: ["movie", "movies"],
  },
  tag: {
    label: "Tag",
    pick: "Tag name",
    path: "/media-collections/tags",
    criterion: (value) => ({ kind: "tag", tagId: value }),
    choose: "Choose a tag",
    explain:
      "The collection keeps every item you tag with it, in release order, as you tag and untag media. Tags never create collections on their own.",
    empty:
      "No media is tagged yet. Add tags to media in the Media Library, then choose one here.",
    unit: ["item", "items"],
  },
  genre: {
    label: "Genre",
    pick: "Genre name",
    path: "/media-collections/genres",
    criterion: (value) => ({ kind: "genre", name: value }),
    choose: "Choose a genre",
    explain:
      "The collection keeps every cataloged item TMDB lists in the genre, in release order. It matches the genre alone, never the collection's name.",
    empty:
      "No genres are known yet. Genres appear once TMDB matches cataloged media.",
    unit: ["item", "items"],
  },
};

/** Names a criterion kind in the words the picker and every card use. */
export function kindLabel(kind: Kind): string {
  return KINDS[kind].label;
}

/** A chosen criterion, the name of what it matches, and whether its preview has loaded. */
export interface CriterionChoice {
  criterion: CollectionCriterion;
  groupName: string;
  previewed: boolean;
}

/**
 * Chooses a criterion: what kind of group it matches, which one, and the
 * server's preview of the members it gives, in order. The browser never
 * matches media itself. With `mediaCollectionId`, the preview applies that
 * collection's exclusions, as changing its criterion would.
 */
export function CriterionPicker({
  initialKind = "series",
  mediaCollectionId,
  disabled,
  onChoice,
}: {
  initialKind?: Kind;
  mediaCollectionId?: string;
  disabled: boolean;
  onChoice: (choice: CriterionChoice | undefined) => void;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const groups = useResource<CatalogOption[]>(KINDS[kind].path);
  const [value, setValue] = useState("");
  const criterion = useMemo<CollectionCriterion | undefined>(
    () => (value === "" ? undefined : KINDS[kind].criterion(value)),
    [kind, value],
  );
  const previewBody = useMemo(
    () =>
      criterion === undefined
        ? undefined
        : mediaCollectionId === undefined
          ? { criterion }
          : { criterion, mediaCollectionId },
    [criterion, mediaCollectionId],
  );
  const preview = useResource<CollectionMember[]>(
    criterion === undefined ? null : "/media-collections/previews",
    true,
    0,
    previewBody,
  );
  const groupName =
    groups.data?.find((item) => optionValue(item) === value)?.name ?? "";
  const previewed = preview.data !== undefined;
  useEffect(() => {
    onChoice(
      criterion === undefined ? undefined : { criterion, groupName, previewed },
    );
  }, [criterion, groupName, previewed, onChoice]);
  const { pick, choose, explain, empty, unit } = KINDS[kind];

  /** Counts items in the unit the chosen kind holds, such as "2 episodes". */
  function count(n: number) {
    return `${n} ${n === 1 ? unit[0] : unit[1]}`;
  }

  return (
    <>
      <fieldset>
        <legend>Matches</legend>
        {(Object.keys(KINDS) as Kind[]).map((option) => (
          <label key={option} className="choice">
            <input
              type="radio"
              name="kind"
              checked={kind === option}
              disabled={disabled}
              onChange={() => {
                setKind(option);
                setValue("");
              }}
            />
            {KINDS[option].label}
          </label>
        ))}
      </fieldset>
      <p>{explain}</p>
      {groups.data?.length === 0 ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <label>
          {pick}
          <select
            value={value}
            required
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">{choose}</option>
            {groups.data?.map((item) => (
              <option key={optionValue(item)} value={optionValue(item)}>
                {item.name} ({count(item.itemCount)})
              </option>
            ))}
          </select>
        </label>
      )}
      <RequestFeedback
        loading={groups.loading || preview.loading}
        error={preview.error ?? groups.error}
      />
      {preview.data && (
        <>
          <p>{count(preview.data.length)} in this order</p>
          <ReadOnlyMembers members={preview.data} />
        </>
      )}
    </>
  );
}

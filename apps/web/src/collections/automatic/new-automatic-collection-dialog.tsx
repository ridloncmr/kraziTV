import { useMemo, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type {
  CatalogGroup,
  CollectionCriterion,
  CollectionMember,
  MediaCollection,
} from "../../http/contracts.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { ReadOnlyMembers } from "./read-only-members.js";

type Kind = CollectionCriterion["kind"];

/** What each criterion kind lists, how it is labelled, and how its members are counted. */
const KINDS: Record<
  Kind,
  {
    label: string;
    /** The picker's own label, distinct from the kind's radio button. */
    pick: string;
    path: string;
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
    choose: "Choose a franchise",
    explain:
      "The collection keeps every cataloged movie of the franchise, in release order, as your catalog changes.",
    empty:
      "No movie franchises are cataloged yet. A franchise appears here once TMDB matches one of its movies.",
    unit: ["movie", "movies"],
  },
};

/**
 * Creates an automatic series or franchise collection: the owner picks what
 * it matches, sees the server's preview of its members in order, and
 * confirms. The preview is the server's answer, so the browser never
 * matches media itself.
 */
export function NewAutomaticCollectionDialog({
  created,
  onClose,
}: {
  created: (collection: MediaCollection) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("series");
  const groups = useResource<CatalogGroup[]>(KINDS[kind].path);
  const [tmdbId, setTmdbId] = useState("");
  // Follows the chosen group until the owner types a name of their own.
  const [name, setName] = useState({ value: "", typed: false });
  const criterion = useMemo<CollectionCriterion | undefined>(
    () => (tmdbId === "" ? undefined : { kind, tmdbId: Number(tmdbId) }),
    [kind, tmdbId],
  );
  const previewBody = useMemo(
    () => (criterion === undefined ? undefined : { criterion }),
    [criterion],
  );
  const preview = useResource<CollectionMember[]>(
    criterion === undefined ? null : "/media-collections/previews",
    true,
    0,
    previewBody,
  );
  const mutation = useMutation();
  const { pick, choose: placeholder, explain, empty, unit } = KINDS[kind];

  /** Switches what the collection matches, dropping a choice of the other kind. */
  function switchKind(next: Kind) {
    setKind(next);
    choose("");
  }

  /** Chooses a group and, unless the owner named the collection, names it after the group. */
  function choose(value: string) {
    setTmdbId(value);
    const chosen = groups.data?.find((item) => String(item.tmdbId) === value);
    if (!name.typed) setName({ value: chosen?.name ?? "", typed: false });
  }

  /** Counts items in the unit the chosen kind holds, such as "2 episodes". */
  function count(n: number) {
    return `${n} ${n === 1 ? unit[0] : unit[1]}`;
  }

  return (
    <WindowDialog
      title="New automatic collection"
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (criterion === undefined) return;
          void mutation.run<MediaCollection>(
            "/media-collections",
            "POST",
            { name: name.value.trim(), criterion },
            created,
          );
        }}
      >
        <fieldset>
          <legend>Matches</legend>
          {(Object.keys(KINDS) as Kind[]).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="kind"
                checked={kind === option}
                disabled={mutation.pending}
                onChange={() => switchKind(option)}
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
              value={tmdbId}
              required
              disabled={mutation.pending}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">{placeholder}</option>
              {groups.data?.map((item) => (
                <option key={item.tmdbId} value={item.tmdbId}>
                  {item.name} ({count(item.itemCount)})
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Collection name
          <input
            value={name.value}
            required
            disabled={mutation.pending}
            onChange={(event) =>
              setName({ value: event.target.value, typed: true })
            }
          />
        </label>
        <RequestFeedback
          loading={groups.loading || preview.loading || mutation.pending}
          error={mutation.error ?? preview.error ?? groups.error}
        />
        {preview.data && (
          <>
            <p>{count(preview.data.length)} in this order</p>
            <ReadOnlyMembers members={preview.data} />
          </>
        )}
        <div className="dialog-actions">
          <button
            type="submit"
            disabled={preview.data === undefined || mutation.pending}
          >
            Create automatic collection
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

import { useMemo, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type {
  CatalogSeries,
  CollectionCriterion,
  CollectionMember,
  MediaCollection,
} from "../../http/contracts.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { ReadOnlyMembers } from "./read-only-members.js";

/**
 * Creates an automatic series collection: the owner picks a series, sees
 * the server's preview of its members in order, and confirms. The preview
 * is the server's answer, so the browser never matches media itself.
 */
export function NewAutomaticCollectionDialog({
  created,
  onClose,
}: {
  created: (collection: MediaCollection) => void;
  onClose: () => void;
}) {
  const series = useResource<CatalogSeries[]>("/media-collections/series");
  const [tmdbId, setTmdbId] = useState("");
  // Follows the chosen series until the owner types a name of their own.
  const [name, setName] = useState({ value: "", typed: false });
  const criterion = useMemo<CollectionCriterion | undefined>(
    () =>
      tmdbId === "" ? undefined : { kind: "series", tmdbId: Number(tmdbId) },
    [tmdbId],
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

  /** Chooses a series and, unless the owner named the collection, names it after the series. */
  function choose(value: string) {
    setTmdbId(value);
    const chosen = series.data?.find((item) => String(item.tmdbId) === value);
    if (!name.typed) setName({ value: chosen?.name ?? "", typed: false });
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
        <p>
          Pick a TV series. The collection keeps every cataloged episode, in
          season and episode order, as your catalog changes.
        </p>
        {series.data?.length === 0 ? (
          <p className="empty-state">
            No TV series are cataloged yet. A series appears here once TMDB
            matches its episodes.
          </p>
        ) : (
          <label>
            TV series
            <select
              value={tmdbId}
              required
              disabled={mutation.pending}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">Choose a series</option>
              {series.data?.map((item) => (
                <option key={item.tmdbId} value={item.tmdbId}>
                  {item.name} ({item.itemCount}{" "}
                  {item.itemCount === 1 ? "episode" : "episodes"})
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
          loading={series.loading || preview.loading || mutation.pending}
          error={mutation.error ?? preview.error ?? series.error}
        />
        {preview.data && (
          <>
            <p>
              {preview.data.length}{" "}
              {preview.data.length === 1 ? "episode" : "episodes"} in this order
            </p>
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

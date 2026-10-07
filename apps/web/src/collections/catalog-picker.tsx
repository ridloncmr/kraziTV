import { useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import { Pager } from "../controls/pager.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MediaItem, MediaItemPage } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import { useMediaItemPage } from "../media-search/use-media-item-page.js";

const PAGE_SIZE = 50;

/**
 * Picks catalog media in bulk: checked items across pages, or every match of
 * the current search at once. Members already in the draft cannot be picked
 * again, so an addition never duplicates a member.
 */
export function CatalogPicker({
  memberIds,
  visible,
  onAdd,
}: {
  memberIds: ReadonlySet<string>;
  visible: boolean;
  onAdd: (media: MediaItem[]) => void;
}) {
  const [search, setSearch] = useState("");
  const results = useMediaItemPage(search, PAGE_SIZE, visible);
  const [picked, setPicked] = useState<ReadonlyMap<string, MediaItem>>(
    new Map(),
  );
  const matches = useMutation();
  const [overflow, setOverflow] = useState<Error>();
  const items = results.data?.items ?? [];
  const total = results.data?.total ?? 0;
  const pickable = items.filter((item) => !memberIds.has(item.id));
  const pagePicked =
    pickable.length > 0 && pickable.every((item) => picked.has(item.id));

  /** Checks or unchecks items while keeping picks made on other pages. */
  function pick(media: MediaItem[], on: boolean) {
    const next = new Map(picked);
    for (const item of media) {
      if (on) next.set(item.id, item);
      else next.delete(item.id);
    }
    setPicked(next);
  }

  /** Hands media to the draft and clears the picks it consumed. */
  function add(media: MediaItem[]) {
    setOverflow(undefined);
    onAdd(media);
    setPicked(new Map());
  }

  /** Adds every match in one step, refusing a capped response rather than adding part of it. */
  function addAllMatches() {
    const params = new URLSearchParams({ q: results.search });
    void matches.run<MediaItemPage>(
      `/media-items/matches?${params}`,
      "GET",
      undefined,
      (page) => {
        if (page.total > page.items.length)
          setOverflow(
            new Error(
              `${page.total} items match; narrow the search to add them all at once.`,
            ),
          );
        else add(page.items);
      },
    );
  }

  return (
    <fieldset className="collection-pane">
      <legend>Add from catalog</legend>
      <label className="search-field">
        Find media
        <input
          type="search"
          value={search}
          placeholder="Title or folder path"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="row-actions">
        <button
          disabled={picked.size === 0}
          onClick={() => add([...picked.values()])}
        >
          Add selected ({picked.size})
        </button>
        <button
          disabled={total === 0 || matches.pending}
          onClick={addAllMatches}
        >
          Add all matches ({total})
        </button>
      </div>
      <RequestFeedback
        loading={matches.pending}
        error={overflow ?? matches.error ?? results.error}
      />
      {results.data && (
        <Pager
          offset={results.offset}
          limit={PAGE_SIZE}
          total={total}
          onChange={results.setOffset}
        />
      )}
      {results.data && total === 0 && (
        <p className="empty-state">
          {results.search
            ? "No cataloged media matches this search."
            : "The catalog is empty. Scan a media root in Media Library."}
        </p>
      )}
      {items.length > 0 && (
        <div className="table-scroll" aria-busy={results.loading}>
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select this page"
                    checked={pagePicked}
                    disabled={pickable.length === 0}
                    onChange={() => pick(pickable, !pagePicked)}
                  />
                </th>
                <th>Title / path</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const member = memberIds.has(item.id);
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        checked={member || picked.has(item.id)}
                        disabled={member}
                        onChange={(event) => pick([item], event.target.checked)}
                      />
                    </td>
                    <td>
                      {item.title}
                      <small className="secondary path-cell">
                        {member ? "In collection · " : ""}
                        {item.status} · {item.path}
                      </small>
                    </td>
                    <td>{displayDuration(item.durationMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  );
}

import { useEffect, useMemo, useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import { Pager } from "../controls/pager.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { useRangeToggle } from "../controls/use-range-toggle.js";
import type { MediaItem, MediaItemPage } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import { useMediaItemPage } from "../media-search/use-media-item-page.js";

const PAGE_SIZE = 50;

/**
 * Picks catalog media in bulk: checked items across pages, or every match of
 * the current search at once. The server leaves draft members out of results
 * and counts, so an addition never duplicates a member.
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
  // Sorted so reordering members never changes the request and refetches.
  const excludeIds = useMemo(() => [...memberIds].sort(), [memberIds]);
  const results = useMediaItemPage(search, PAGE_SIZE, visible, excludeIds);
  const [picked, setPicked] = useState<ReadonlyMap<string, MediaItem>>(
    new Map(),
  );
  const matches = useMutation();
  const [overflow, setOverflow] = useState<Error>();
  // The previous page stays shown while the next loads, so drop media added since.
  const items = (results.data?.items ?? []).filter(
    (item) => !memberIds.has(item.id),
  );
  const total = results.data?.total ?? 0;
  const { offset, setOffset } = results;
  // Adding the last rows of the final page leaves the offset past the end.
  useEffect(() => {
    if (results.data && offset > 0 && offset >= total)
      setOffset(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) * PAGE_SIZE);
  }, [results.data, offset, total, setOffset]);
  const pagePicked =
    items.length > 0 && items.every((item) => picked.has(item.id));
  // Results arrive a page at a time, so Shift ranges stay within this page.
  const range = useRangeToggle(
    items.map((item) => item.id),
    (id) => picked.has(id),
    (ids, on) =>
      pick(
        items.filter((item) => ids.includes(item.id)),
        on,
      ),
  );

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
    void matches.run<MediaItemPage>(
      "/media-items/matches",
      "POST",
      { q: results.search, excludeIds },
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
          Add all ({total})
        </button>
        <button
          disabled={picked.size === 0}
          onClick={() => setPicked(new Map())}
        >
          Clear selection
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
            ? "No cataloged media outside this collection matches this search."
            : memberIds.size > 0
              ? "Every cataloged item is already in this collection."
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
                    onChange={() => pick(items, !pagePicked)}
                  />
                </th>
                <th>Title / path</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`clickable-row${picked.has(item.id) ? " selected-row" : ""}`}
                  {...range.row(item.id)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.title}`}
                      checked={picked.has(item.id)}
                      onChange={range.checkbox(item.id)}
                    />
                  </td>
                  <td>
                    {item.title}
                    <small className="secondary path-cell">
                      {item.status} · {item.path}
                    </small>
                  </td>
                  <td>{displayDuration(item.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  );
}

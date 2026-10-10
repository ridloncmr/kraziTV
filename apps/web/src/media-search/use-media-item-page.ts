import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaItemPage } from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";

const SEARCH_DELAY_MS = 250;

/**
 * What a page leaves out: IDs a picker hides, or every item whose match does
 * not need the owner's choice. The server applies either, never both.
 */
type PageFilter = { excludeIds: readonly string[] } | { needsChoice: boolean };

/**
 * Reads one server-side page of the catalog so no program loads every item.
 * Typed search waits for a pause before it refetches, and a new search or
 * filter returns to the first page in the same update so no stale page is
 * requested. The server applies the filter to the page and its total, so a
 * list never pages through items it hides.
 */
export function useMediaItemPage(
  search: string,
  limit: number,
  active: boolean,
  filter?: PageFilter,
) {
  const excludeIds =
    filter && "excludeIds" in filter ? filter.excludeIds : undefined;
  const needsChoice =
    filter !== undefined && "needsChoice" in filter && filter.needsChoice;
  const [query, setQuery] = useState({
    q: search.trim(),
    offset: 0,
    needsChoice,
  });
  // Set during render, so the request after a filter change is already for page one.
  if (query.needsChoice !== needsChoice) {
    setQuery({ ...query, offset: 0, needsChoice });
  }
  useEffect(() => {
    const q = search.trim();
    const timer = setTimeout(
      () =>
        setQuery((current) =>
          current.q === q ? current : { ...current, q, offset: 0 },
        ),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    q: query.q,
    limit: String(limit),
    offset: String(query.offset),
  });
  if (query.needsChoice) params.set("needsChoice", "true");
  // Stable between renders so the resource re-serializes the excluded IDs only when they or the query change.
  const body = useMemo(
    () =>
      excludeIds && {
        q: query.q,
        limit,
        offset: query.offset,
        excludeIds,
      },
    [excludeIds, query.q, query.offset, limit],
  );
  const page = useResource<MediaItemPage>(
    excludeIds ? "/media-items/search" : `/media-items?${params}`,
    active,
    0,
    body,
  );
  // The last page stays on screen while the next one loads, so a list never
  // empties mid-request and its scroll position survives paging and searching.
  const [shown, setShown] = useState<MediaItemPage>();
  useEffect(() => {
    if (page.data) setShown(page.data);
  }, [page.data]);
  /** Keeps the current search while moving between pages. */
  const setOffset = useCallback(
    (offset: number) => setQuery((current) => ({ ...current, offset })),
    [],
  );
  return {
    ...page,
    data: page.data ?? shown,
    // The settled search the page answers, which typing may not have reached yet.
    search: query.q,
    offset: query.offset,
    setOffset,
  };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaFilter, MediaItemPage } from "../http/contracts/media.js";
import { useResource } from "../http/resources/use-resource.js";

const SEARCH_DELAY_MS = 250;

/**
 * What a page leaves out: IDs a picker hides, every item a list filter does
 * not keep, or both. Excluded IDs travel in a POST body, since a large
 * collection's member IDs would overflow a query string.
 */
type PageFilter = { excludeIds?: readonly string[]; filter?: MediaFilter };

// A filter as query parameters, each key repeated once per value, in a
// fixed order so an equal filter always yields the same text.
function filterParams(filter: MediaFilter): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(filter).sort() as (keyof MediaFilter)[]) {
    for (const value of filter[key] ?? []) params.append(key, value);
  }
  return params.toString();
}

/** Turns `filterParams` text back into a filter, for a request body. */
function filterFromParams(text: string): MediaFilter {
  const filter: Partial<Record<string, string[]>> = {};
  for (const [key, value] of new URLSearchParams(text)) {
    (filter[key] ??= []).push(value);
  }
  return filter;
}

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
  const excludeIds = filter?.excludeIds;
  const kept = filterParams(filter?.filter ?? {});
  const [query, setQuery] = useState({
    q: search.trim(),
    offset: 0,
    kept,
  });
  // Set during render, so the request after a filter change is already for page one.
  if (query.kept !== kept) {
    setQuery({ ...query, offset: 0, kept });
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
  const params = new URLSearchParams(query.kept);
  params.set("q", query.q);
  params.set("limit", String(limit));
  params.set("offset", String(query.offset));
  // Stable between renders so the resource re-serializes the excluded IDs only when they or the query change.
  const body = useMemo(
    () =>
      excludeIds && {
        q: query.q,
        limit,
        offset: query.offset,
        excludeIds,
        filter: filterFromParams(query.kept),
      },
    [excludeIds, query.q, query.offset, query.kept, limit],
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

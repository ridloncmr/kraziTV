import { useCallback, useEffect, useState } from "react";
import type { MediaItemPage } from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";

const SEARCH_DELAY_MS = 250;

/**
 * Reads one server-side page of the catalog so no program loads every item.
 * Typed search waits for a pause before it refetches, and a new search
 * returns to the first page in the same update so no stale page is requested.
 */
export function useMediaItemPage(
  search: string,
  limit: number,
  active: boolean,
) {
  const [query, setQuery] = useState({ q: search.trim(), offset: 0 });
  useEffect(() => {
    const q = search.trim();
    const timer = setTimeout(
      () =>
        setQuery((current) => (current.q === q ? current : { q, offset: 0 })),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    q: query.q,
    limit: String(limit),
    offset: String(query.offset),
  });
  const page = useResource<MediaItemPage>(`/media-items?${params}`, active);
  /** Keeps the current search while moving between pages. */
  const setOffset = useCallback(
    (offset: number) => setQuery((current) => ({ ...current, offset })),
    [],
  );
  return { ...page, offset: query.offset, setOffset };
}

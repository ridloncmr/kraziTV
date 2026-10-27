import { useState } from "react";
import {
  optionValue,
  type CatalogOption,
} from "../catalog-options/catalog-option.js";
import type {
  MediaFilter,
  MediaFilterKey,
  MediaRoot,
} from "../http/contracts/media.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { useResource } from "../http/resources/use-resource.js";
import { FilterSection, type FilterOption } from "./filter-section.js";

/** Sections whose values never change. */
const FIXED_SECTIONS: {
  key: MediaFilterKey;
  legend: string;
  options: FilterOption[];
}[] = [
  {
    key: "matchState",
    legend: "Match",
    options: [
      { value: "matched", label: "Matched" },
      { value: "ambiguous", label: "Needs your choice" },
      { value: "unmatched", label: "Unmatched" },
      { value: "lookup_failed", label: "Lookup failed" },
      { value: "rejected", label: "Rejected" },
      { value: "not_looked_up", label: "Not looked up" },
      { value: "file_changed", label: "File changed" },
      { value: "episode_unlisted", label: "Episode not listed on TMDB" },
    ],
  },
  {
    key: "contentType",
    legend: "Type",
    options: [
      { value: "movie", label: "Movie" },
      { value: "episode", label: "TV episode" },
      { value: "extra", label: "Extra" },
      { value: "unidentified", label: "Unidentified" },
    ],
  },
  {
    key: "status",
    legend: "Availability",
    options: [
      { value: "available", label: "Available" },
      { value: "missing", label: "Missing" },
      { value: "probe_failed", label: "Probe failed" },
    ],
  },
  {
    key: "detail",
    legend: "Details",
    options: [
      { value: "corrected", label: "Corrected by you" },
      { value: "tmdb_expired", label: "TMDB data expired" },
      { value: "refresh_failed", label: "TMDB refresh failed" },
    ],
  },
  {
    key: "collection",
    legend: "Collections",
    options: [{ value: "none", label: "In no collection" }],
  },
];

/**
 * Sections listing what the catalog holds, read from the same lists a
 * collection criterion is chosen from, so a filter and a criterion name the
 * same items.
 */
const CATALOG_SECTIONS: {
  key: MediaFilterKey;
  legend: string;
  path: string;
  empty: string;
}[] = [
  {
    key: "seriesTmdbId",
    legend: "TV series",
    path: "/media-collections/series",
    empty: "No TV series are matched yet.",
  },
  {
    key: "franchiseTmdbId",
    legend: "Franchise",
    path: "/media-collections/franchises",
    empty: "No movie franchises are matched yet.",
  },
  {
    key: "genre",
    legend: "Genre",
    path: "/media-collections/genres",
    empty: "No genres are known yet.",
  },
  {
    key: "tagId",
    legend: "Tag",
    path: "/media-collections/tags",
    empty: "No media is tagged yet.",
  },
];

/**
 * The dialog's panels in reading order, three to a row: the fixed sections,
 * then what the catalog holds, then media roots and tags across a wide last
 * row. A panel is one section or a stack of two short ones.
 */
const PANELS: { keys: MediaFilterKey[]; wide?: boolean }[] = [
  { keys: ["matchState"] },
  { keys: ["contentType", "status"] },
  { keys: ["detail", "collection"] },
  { keys: ["seriesTmdbId"] },
  { keys: ["franchiseTmdbId"] },
  { keys: ["genre"] },
  { keys: ["mediaRootId"], wide: true },
  { keys: ["tagId"], wide: true },
];

/** Counts the filter keys in use, which the Filter button shows. */
export function keysInUse(filter: MediaFilter): number {
  return Object.values(filter).filter((values) => values.length > 0).length;
}

/**
 * The **Filter** dialog for any list of cataloged media items. Checking values changes only
 * a draft, which starts from the applied filter each time the dialog opens:
 * **Apply** hands the draft over, **Clear** hands over no filter, and
 * closing any other way discards the draft.
 */
export function CatalogFilterDialog({
  applied,
  roots,
  onApply,
  onClose,
}: {
  applied: MediaFilter;
  /** Undefined while the caller is still reading them. */
  roots: readonly MediaRoot[] | undefined;
  onApply: (filter: MediaFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MediaFilter>(applied);
  /** Checks or unchecks one value of one key, dropping a key left empty. */
  function toggle(key: MediaFilterKey, value: string, on: boolean) {
    setDraft((current) => {
      const rest = (current[key] ?? []).filter((kept) => kept !== value);
      const values = on ? [...rest, value] : rest;
      const next = { ...current };
      if (values.length > 0) next[key] = values;
      else delete next[key];
      return next;
    });
  }
  /** One section's props for `key`, wired to the draft. */
  function section(key: MediaFilterKey) {
    return {
      chosen: draft[key] ?? [],
      onToggle: (value: string, on: boolean) => toggle(key, value, on),
    };
  }
  /** The section that filters on `key`, whichever list its values come from. */
  function filterSection(key: MediaFilterKey) {
    const fixed = FIXED_SECTIONS.find((entry) => entry.key === key);
    if (fixed) {
      return (
        <FilterSection
          key={key}
          legend={fixed.legend}
          options={fixed.options}
          empty=""
          {...section(key)}
        />
      );
    }
    const listed = CATALOG_SECTIONS.find((entry) => entry.key === key);
    if (listed) {
      return (
        <CatalogFilterSection
          key={key}
          legend={listed.legend}
          path={listed.path}
          empty={listed.empty}
          {...section(key)}
        />
      );
    }
    return (
      <FilterSection
        key={key}
        legend="Media root"
        options={(roots ?? []).map((root) => ({
          value: root.id,
          label: root.path,
        }))}
        empty={roots ? "No media roots yet." : "Loading…"}
        {...section(key)}
      />
    );
  }
  return (
    <WindowDialog title="Filter media" onClose={onClose}>
      <div className="filter-sections">
        {PANELS.map(({ keys, wide }) => (
          <div
            key={keys.join()}
            className={wide ? "filter-panel filter-wide" : "filter-panel"}
          >
            {keys.map(filterSection)}
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={() => onApply({})}>
          Clear
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={() => onApply(draft)}>
          Apply
        </button>
      </div>
    </WindowDialog>
  );
}

/**
 * A section whose values the server lists. While the list loads or fails
 * the section says so instead of showing an empty list.
 */
function CatalogFilterSection({
  legend,
  path,
  empty,
  chosen,
  onToggle,
}: {
  legend: string;
  path: string;
  empty: string;
  chosen: readonly string[];
  onToggle: (value: string, on: boolean) => void;
}) {
  const rows = useResource<CatalogOption[]>(path);
  const options = (rows.data ?? []).map((row) => ({
    value: optionValue(row),
    label: row.name,
    itemCount: row.itemCount,
  }));
  return (
    <FilterSection
      legend={legend}
      options={options}
      chosen={chosen}
      onToggle={onToggle}
      empty={
        rows.error
          ? `Could not load: ${rows.error.message}`
          : rows.data
            ? empty
            : "Loading…"
      }
    />
  );
}

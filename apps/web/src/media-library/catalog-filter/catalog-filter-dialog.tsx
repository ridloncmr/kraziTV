import { useState } from "react";
import {
  optionValue,
  type CatalogOption,
} from "../../catalog-options/catalog-option.js";
import type {
  MediaFilter,
  MediaFilterKey,
  MediaRoot,
} from "../../http/contracts/media.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { useResource } from "../../http/use-resource.js";
import { FilterSection, type FilterOption } from "./filter-section.js";

/** Sections whose values never change, in the order the dialog shows them. */
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
      { value: "extra", label: "Extra" },
    ],
  },
  {
    key: "contentType",
    legend: "Type",
    options: [
      { value: "movie", label: "Movie" },
      { value: "episode", label: "TV episode" },
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

/** Counts the filter keys in use, which the Filter button shows. */
export function keysInUse(filter: MediaFilter): number {
  return Object.values(filter).filter((values) => values.length > 0).length;
}

/**
 * The cataloged media list's **Filter** dialog. Checking values changes only
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
  roots: readonly MediaRoot[];
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
  return (
    <WindowDialog title="Filter media" onClose={onClose}>
      <div className="filter-sections">
        {FIXED_SECTIONS.map(({ key, legend, options }) => (
          <FilterSection
            key={key}
            legend={legend}
            options={options}
            empty=""
            {...section(key)}
          />
        ))}
        <FilterSection
          legend="Media root"
          options={roots.map((root) => ({ value: root.id, label: root.path }))}
          empty="No media roots yet."
          {...section("mediaRootId")}
        />
        {CATALOG_SECTIONS.map(({ key, legend, path, empty }) => (
          <CatalogFilterSection
            key={key}
            legend={legend}
            path={path}
            empty={empty}
            {...section(key)}
          />
        ))}
      </div>
      <div className="dialog-actions">
        <button onClick={() => onApply({})}>Clear</button>
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => onApply(draft)}>Apply</button>
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

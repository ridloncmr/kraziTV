import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  optionValue,
  type CatalogOption,
} from "../../catalog-options/catalog-option.js";
import type {
  MediaFilter,
  MediaFilterKey,
  MediaRoot,
} from "../../http/contracts/media.js";
import { useResource } from "../../http/use-resource.js";
import { FilterSection, type FilterOption } from "./filter-section.js";

/** Sections whose values never change, in the order the panel shows them. */
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

/** Counts the filter keys in use, which the button shows. */
function keysInUse(filter: MediaFilter): number {
  return Object.values(filter).filter((values) => values.length > 0).length;
}

// The panel's widest extent, so it moves left rather than leave the screen.
const PANEL_WIDTH = 620;

/**
 * Where the panel drops from its button, in viewport pixels. The panel
 * floats over the desktop like an XP menu, so a small window never clips it;
 * its height stops above the taskbar.
 */
function dropFrom(button: HTMLElement): CSSProperties {
  const rect = button.getBoundingClientRect();
  const top = rect.bottom + 4;
  return {
    top,
    left: Math.max(8, Math.min(rect.left, innerWidth - PANEL_WIDTH - 8)),
    maxHeight: `calc(100vh - ${top}px - var(--xp-taskbar-height) - 8px)`,
  };
}

/**
 * The cataloged media list's **Filter** button and its panel. Checking
 * values changes only a draft; **Apply** hands the draft over and **Clear**
 * hands over no filter. Closing the panel any other way, by Escape, a click
 * outside it, or scrolling or resizing what it drops from, discards the
 * draft, since the panel would no longer sit under its button.
 */
export function CatalogFilterButton({
  applied,
  roots,
  onApply,
}: {
  applied: MediaFilter;
  roots: readonly MediaRoot[];
  onApply: (filter: MediaFilter) => void;
}) {
  const [drop, setDrop] = useState<CSSProperties>();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = drop !== undefined;
  // The panel renders at the end of the page, so focus moves into it on
  // opening; otherwise Tab from the button would skip past it.
  useEffect(() => {
    if (open) {
      panel.current
        ?.querySelector<HTMLElement>("input, button")
        ?.focus({ preventScroll: true });
    }
  }, [open]);
  /** Closes from inside the panel or by Escape, returning focus to the button. */
  function dismiss() {
    setDrop(undefined);
    button.current?.focus();
  }
  // Listens only while open, so a closed panel costs nothing.
  useEffect(() => {
    if (!open) return;
    const close = () => setDrop(undefined);
    // The button toggles itself, so a press on it is not a press outside.
    function closeOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        close();
    }
    // Escape dismisses the panel as it dismisses an XP menu, dropping the draft.
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    // A section list scrolling inside the panel leaves it in place.
    function closeOnScroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const used = keysInUse(applied);
  return (
    <>
      <button
        ref={button}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() =>
          setDrop(
            open || !button.current ? undefined : dropFrom(button.current),
          )
        }
      >
        {used > 0 ? `Filter (${used})` : "Filter"}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="program-page filter-panel"
            role="dialog"
            aria-label="Filter media"
            style={drop}
          >
            <FilterPanel
              applied={applied}
              roots={roots}
              onApply={(filter) => {
                dismiss();
                onApply(filter);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The open panel's content. It mounts on opening, so its draft starts from
 * the applied filter and its catalog lists are read fresh each time.
 */
function FilterPanel({
  applied,
  roots,
  onApply,
}: {
  applied: MediaFilter;
  roots: readonly MediaRoot[];
  onApply: (filter: MediaFilter) => void;
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
    <>
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
      <div className="row-actions filter-panel-actions">
        <button onClick={() => onApply({})}>Clear</button>
        <button onClick={() => onApply(draft)}>Apply</button>
      </div>
    </>
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

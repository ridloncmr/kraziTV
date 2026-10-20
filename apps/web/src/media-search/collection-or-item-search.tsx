import { useEffect, useId, useRef, useState } from "react";
import {
  CatalogFilterDialog,
  keysInUse,
} from "../catalog-filter/catalog-filter-dialog.js";
import { Pager } from "../controls/pager.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import type { MediaFilter, MediaRoot } from "../http/contracts/media.js";
import type { AssignmentMember } from "../http/contracts/programming.js";
import { useResource } from "../http/use-resource.js";
import { useMediaItemPage } from "./use-media-item-page.js";

const ITEM_LIMIT = 25;

/** One search result: a collection or a single item, with the name it shows. */
export interface FoundMember {
  member: AssignmentMember;
  name: string;
  /** What tells the result apart from others of the same name. */
  detail: string;
}

/**
 * Searches media collections or single media items, as the owner toggles,
 * with a checkbox per result; checks survive the toggle because the caller
 * holds them. Collections are matched by name from the list the caller
 * already holds. Items come one server page at a time, narrowed by the same
 * **Filter** dialog the Media Library uses, so the results never hold the
 * whole catalog. `unavailable` results show why they cannot be checked;
 * `hidden` results are left out entirely, for a caller where they would be
 * clutter, so a page of items may show fewer than its limit.
 */
export function CollectionOrItemSearch({
  collections,
  checked,
  unavailable = new Map(),
  hidden = new Set(),
  visible,
  onToggle,
}: {
  collections: readonly MediaCollection[] | undefined;
  /** Results shown checked, by member key. */
  checked: ReadonlySet<string>;
  /** Results that cannot be checked, by member key, with the reason. */
  unavailable?: ReadonlyMap<string, string>;
  /** Results left out of the list, by member key. */
  hidden?: ReadonlySet<string>;
  visible: boolean;
  onToggle: (found: FoundMember, checked: boolean) => void;
}) {
  const kindName = useId();
  const [kind, setKind] = useState<"collections" | "items">("collections");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MediaFilter>({});
  const [filtering, setFiltering] = useState(false);
  const items = useMediaItemPage(
    search,
    ITEM_LIMIT,
    visible && kind === "items",
    { filter },
  );
  // Only the filter dialog lists media roots, so they are read while it is open.
  const roots = useResource<MediaRoot[]>(
    filtering ? "/media-roots" : null,
    visible,
  );
  const filtersInUse = keysInUse(filter);
  const words = search.trim().toLowerCase();
  const matched: FoundMember[] =
    kind === "collections"
      ? (collections ?? [])
          .filter((collection) => collection.name.toLowerCase().includes(words))
          .map((collection) => ({
            member: {
              kind: "collection" as const,
              mediaCollectionId: collection.id,
            },
            name: collection.name,
            detail:
              collection.maintenanceMode === "automatic"
                ? "Automatic collection"
                : "Manual collection",
          }))
      : (items.data?.items ?? []).map((item) => ({
          member: { kind: "media_item" as const, mediaItemId: item.id },
          name: item.title,
          detail: item.path,
        }));
  const found = matched.filter(
    (result) => !hidden.has(memberKey(result.member)),
  );
  const empty =
    matched.length > 0 && found.length === 0
      ? kind === "collections"
        ? "Every matching collection is already added."
        : "Everything on this page is already added."
      : kind === "collections"
        ? collections && found.length === 0
          ? words
            ? "No collection matches that search."
            : "There are no collections yet."
          : undefined
        : items.data?.total === 0
          ? items.search
            ? "No media matches that search."
            : filtersInUse > 0
              ? "No media matches these filters."
              : "The catalog has no media yet."
          : undefined;
  return (
    <div>
      <fieldset className="inline-form">
        <legend>Search</legend>
        <label className="choice">
          <input
            type="radio"
            name={kindName}
            checked={kind === "collections"}
            onChange={() => setKind("collections")}
          />
          Collections
        </label>
        <label className="choice">
          <input
            type="radio"
            name={kindName}
            checked={kind === "items"}
            onChange={() => setKind("items")}
          />
          Single items
        </label>
      </fieldset>
      <label className="search-field">
        {kind === "collections" ? "Find collections" : "Find media"}
        <input
          type="search"
          value={search}
          placeholder={
            kind === "collections" ? "Collection name" : "Title or path"
          }
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {kind === "items" && (
        <div className="list-toolbar">
          <button type="button" onClick={() => setFiltering(true)}>
            {filtersInUse > 0 ? `Filter (${filtersInUse})…` : "Filter…"}
          </button>
          {items.data && (
            <Pager
              offset={items.offset}
              limit={ITEM_LIMIT}
              total={items.data.total}
              onChange={items.setOffset}
            />
          )}
        </div>
      )}
      {found.length > 0 && (
        <SelectAllHeader
          label={kind === "items" ? "Select all on this page" : "Select all"}
          selectable={found.filter(
            (result) => !unavailable.has(memberKey(result.member)),
          )}
          checked={checked}
          onToggle={onToggle}
        />
      )}
      <ul
        aria-label="Search results"
        aria-busy={kind === "items" && items.loading}
        className="checkbox-list"
      >
        {found.map((result) => {
          const key = memberKey(result.member);
          const reason = unavailable.get(key);
          return (
            <li key={key}>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={checked.has(key)}
                  disabled={reason !== undefined}
                  onChange={(event) => onToggle(result, event.target.checked)}
                />
                {result.name}{" "}
                <small className="secondary">
                  {result.detail}
                  {reason ? ` · ${reason}` : ""}
                </small>
              </label>
            </li>
          );
        })}
      </ul>
      {empty && <p className="secondary">{empty}</p>}
      {kind === "items" && (
        <RequestFeedback loading={items.loading} error={items.error} />
      )}
      {filtering && (
        <CatalogFilterDialog
          applied={filter}
          roots={roots.data}
          onApply={(applied) => {
            setFiltering(false);
            setFilter(applied);
          }}
          onClose={() => setFiltering(false)}
        />
      )}
    </div>
  );
}

/**
 * The results' header: one checkbox that checks every shown result that can
 * be checked, or unchecks them all once they are. It shows mixed while only
 * some are checked, and toggles each changed result through `onToggle`, so
 * the caller's per-result rules still apply.
 */
function SelectAllHeader({
  label,
  selectable,
  checked,
  onToggle,
}: {
  label: string;
  selectable: readonly FoundMember[];
  checked: ReadonlySet<string>;
  onToggle: (found: FoundMember, checked: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  const count = selectable.filter((result) =>
    checked.has(memberKey(result.member)),
  ).length;
  const all = count > 0 && count === selectable.length;
  // Mixed is a DOM property with no attribute, so it is set after render.
  useEffect(() => {
    if (box.current) box.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <div className="checkbox-list-header">
      <label className="choice">
        <input
          ref={box}
          type="checkbox"
          checked={all}
          disabled={selectable.length === 0}
          onChange={() => {
            for (const result of selectable) {
              if (checked.has(memberKey(result.member)) === all) {
                onToggle(result, !all);
              }
            }
          }}
        />
        {label}
      </label>
    </div>
  );
}

/** Identifies a member by kind and ID, so a result matches its saved member. */
export function memberKey(member: AssignmentMember): string {
  return member.kind === "collection"
    ? `collection:${member.mediaCollectionId}`
    : `media_item:${member.mediaItemId}`;
}

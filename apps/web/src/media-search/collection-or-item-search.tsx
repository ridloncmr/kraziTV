import { useEffect, useId, useRef, useState } from "react";
import {
  CatalogFilterDialog,
  keysInUse,
} from "../catalog-filter/catalog-filter-dialog.js";
import { CollectionTypeSelect } from "../collection-types/collection-type-select.js";
import {
  type CollectionType,
  collectionTypeLabel,
  collectionTypeOf,
  hasCollectionType,
} from "../collection-types/collection-type.js";
import { Pager } from "../controls/pager/pager.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import type { ProgramId } from "../desktop/contracts.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import type { MediaFilter, MediaRoot } from "../http/contracts/media.js";
import type { AssignmentMember } from "../http/contracts/programming.js";
import { useResource } from "../http/resources/use-resource.js";
import { useMediaItemPage } from "./use-media-item-page.js";

const ITEM_LIMIT = 25;

// The two empty results that mean nothing exists to pick yet, rather than
// nothing matching, so the next step is in Media Library.
const NO_COLLECTIONS_YET = "There are no collections yet.";
const NO_MEDIA_YET = "The catalog has no media yet.";

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
 * holds them. Collections are matched by name, and optionally narrowed to
 * one collection type, from the list the caller already holds. Items come
 * one server page at a time, narrowed by the same **Filter** dialog the
 * Media Library uses, so the results never hold the whole catalog.
 * `unavailable` results show why they cannot be checked; `hidden` results
 * are left out entirely, for a caller where they would be clutter, so a
 * page of items may show fewer than its limit. When nothing exists to pick
 * yet, the empty result opens Media Library.
 */
export function CollectionOrItemSearch({
  collections,
  checked,
  unavailable = new Map(),
  hidden = new Set(),
  visible,
  onToggle,
  openProgram,
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
  /** Opens another program, such as Media Library when there is nothing to pick. */
  openProgram: (id: ProgramId) => void;
}) {
  const kindName = useId();
  const [kind, setKind] = useState<"collections" | "items">("collections");
  const [search, setSearch] = useState("");
  // Narrows the collections to one collection type; null shows every type.
  const [type, setType] = useState<CollectionType | null>(null);
  const [filter, setFilter] = useState<MediaFilter>({});
  const [filtering, setFiltering] = useState(false);
  const list = useRef<HTMLUListElement>(null);
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
          .filter(
            (collection) =>
              hasCollectionType(collection, type) &&
              collection.name.toLowerCase().includes(words),
          )
          .map((collection) => ({
            member: {
              kind: "collection" as const,
              mediaCollectionId: collection.id,
            },
            name: collection.name,
            // Its type tells apart collections whose names read alike.
            detail: collectionTypeLabel(collectionTypeOf(collection)),
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
          ? words || type
            ? "No collection matches that search."
            : NO_COLLECTIONS_YET
          : undefined
        : items.data?.total === 0
          ? items.search
            ? "No media matches that search."
            : filtersInUse > 0
              ? "No media matches these filters."
              : NO_MEDIA_YET
          : undefined;
  const nothingYet = empty === NO_COLLECTIONS_YET || empty === NO_MEDIA_YET;
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
      <div className="inline-form">
        <label>
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
        {kind === "collections" && collections && (
          <CollectionTypeSelect
            collections={collections.filter(
              (collection) =>
                !hidden.has(
                  memberKey({
                    kind: "collection",
                    mediaCollectionId: collection.id,
                  }),
                ),
            )}
            value={type}
            onChange={setType}
          />
        )}
      </div>
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
              list={list}
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
        ref={list}
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
      {empty && (
        <p className="secondary">
          {empty}
          {nothingYet && (
            <>
              {" "}
              <button type="button" onClick={() => openProgram("media")}>
                Open Media Library
              </button>
            </>
          )}
        </p>
      )}
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

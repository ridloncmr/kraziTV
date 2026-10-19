import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import type { AssignmentMember } from "../http/contracts/programming.js";
import { useMediaItemPage } from "./use-media-item-page.js";

const ITEM_LIMIT = 25;

/** One search result: a collection or a single item, with the name it shows. */
export interface FoundMember {
  member: AssignmentMember;
  name: string;
}

/**
 * One search over media collections and single media items together, each
 * labeled by kind, with a checkbox per result. Collections are matched by
 * name from the list the caller already holds; items come from the
 * server's catalog search, so the results never hold the whole catalog.
 * `unavailable` results show why they cannot be checked.
 */
export function CollectionOrItemSearch({
  collections,
  checked,
  unavailable = new Map(),
  visible,
  onToggle,
}: {
  collections: readonly MediaCollection[] | undefined;
  /** Results shown checked, by member key. */
  checked: ReadonlySet<string>;
  /** Results that cannot be checked, by member key, with the reason. */
  unavailable?: ReadonlyMap<string, string>;
  visible: boolean;
  onToggle: (found: FoundMember, checked: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const items = useMediaItemPage(search, ITEM_LIMIT, visible);
  const words = search.trim().toLowerCase();
  const found: FoundMember[] = [
    ...(collections ?? [])
      .filter((collection) => collection.name.toLowerCase().includes(words))
      .map((collection) => ({
        member: {
          kind: "collection" as const,
          mediaCollectionId: collection.id,
        },
        name: collection.name,
      })),
    ...(items.data?.items ?? []).map((item) => ({
      member: { kind: "media_item" as const, mediaItemId: item.id },
      name: item.title,
    })),
  ];
  const hidden = (items.data?.total ?? 0) - (items.data?.items.length ?? 0);
  return (
    <div>
      <label>
        Find collections and media
        <input
          type="search"
          value={search}
          placeholder="Collection name, title, or path"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <ul aria-label="Search results" className="checkbox-list">
        {found.map((result) => {
          const key = memberKey(result.member);
          const reason = unavailable.get(key);
          return (
            <li key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={checked.has(key)}
                  disabled={reason !== undefined}
                  onChange={(event) => onToggle(result, event.target.checked)}
                />
                {result.name}{" "}
                <small className="secondary">
                  {result.member.kind === "collection"
                    ? "Collection"
                    : "Media item"}
                  {reason ? ` · ${reason}` : ""}
                </small>
              </label>
            </li>
          );
        })}
      </ul>
      {found.length === 0 && items.data && (
        <p className="secondary">Nothing matches that search.</p>
      )}
      {hidden > 0 && (
        <small className="secondary">
          {hidden} more media items match. Refine the search to narrow them.
        </small>
      )}
      <RequestFeedback loading={items.loading} error={items.error} />
    </div>
  );
}

/** Identifies a member by kind and ID, so a result matches its saved member. */
export function memberKey(member: AssignmentMember): string {
  return member.kind === "collection"
    ? `collection:${member.mediaCollectionId}`
    : `media_item:${member.mediaItemId}`;
}

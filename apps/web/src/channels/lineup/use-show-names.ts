import { useEffect, useState } from "react";
import { apiRequest, resourcePath } from "../../http/api-client.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type { MediaItem } from "../../http/contracts/media.js";
import type { SourceAssignment } from "../../http/contracts/programming.js";
import { joinShowNames } from "./show-labels.js";

/**
 * Names each show in the lineup by its members: collections from the
 * collection list, single items by their titles, read once each by ID since
 * the lineup holds few. A member not read yet, or whose read failed, is
 * named generically, so the lineup never waits on a title.
 */
export function useShowNames(
  assignments: readonly SourceAssignment[],
  collections: readonly MediaCollection[] | undefined,
  visible: boolean,
): (assignment: SourceAssignment) => string {
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const itemIds = [
    ...new Set(
      assignments.flatMap((assignment) =>
        assignment.members.flatMap((member) =>
          member.kind === "media_item" ? [member.mediaItemId] : [],
        ),
      ),
    ),
  ].sort();
  const missing = itemIds.filter((id) => !titles.has(id)).join(",");
  useEffect(() => {
    if (!visible || missing === "") return;
    const controller = new AbortController();
    for (const id of missing.split(",")) {
      apiRequest<MediaItem>(resourcePath("media-items", id), {
        signal: controller.signal,
      }).then(
        (item) => setTitles((current) => new Map(current).set(id, item.title)),
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [missing, visible]);
  return (assignment) =>
    joinShowNames(
      assignment.members.map((member) =>
        member.kind === "collection"
          ? (collections?.find(({ id }) => id === member.mediaCollectionId)
              ?.name ?? "A collection")
          : (titles.get(member.mediaItemId) ?? "A media item"),
      ),
    );
}

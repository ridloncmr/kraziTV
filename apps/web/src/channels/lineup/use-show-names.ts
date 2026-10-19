import { resourcePath } from "../../http/api-client.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type { MediaItem } from "../../http/contracts/media.js";
import type { SourceAssignment } from "../../http/contracts/programming.js";
import { useResourceMap } from "../../http/use-resource.js";
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
  const itemPath = (id: string) => resourcePath("media-items", id);
  const items = useResourceMap<MediaItem>(
    assignments.flatMap((assignment) =>
      assignment.members.flatMap((member) =>
        member.kind === "media_item" ? [itemPath(member.mediaItemId)] : [],
      ),
    ),
    visible,
  );
  return (assignment) =>
    joinShowNames(
      assignment.members.map((member) =>
        member.kind === "collection"
          ? (collections?.find(({ id }) => id === member.mediaCollectionId)
              ?.name ?? "A collection")
          : (items.get(itemPath(member.mediaItemId))?.title ?? "A media item"),
      ),
    );
}

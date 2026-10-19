import { resourcePath } from "../../http/api-client.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type { MediaItem } from "../../http/contracts/media.js";
import type { AssignmentMember } from "../../http/contracts/programming.js";
import { useResourceMap } from "../../http/use-resource.js";

/**
 * Names shows' members: collections from the collection list, single items
 * by their titles, read once each by ID since a lineup holds few. A member
 * not read yet, or whose read failed, is named generically, so a list never
 * waits on a title.
 */
export function useMemberNames(
  members: readonly AssignmentMember[],
  collections: readonly MediaCollection[] | undefined,
  visible: boolean,
): (member: AssignmentMember) => string {
  const itemPath = (id: string) => resourcePath("media-items", id);
  const items = useResourceMap<MediaItem>(
    members.flatMap((member) =>
      member.kind === "media_item" ? [itemPath(member.mediaItemId)] : [],
    ),
    visible,
  );
  return (member) =>
    member.kind === "collection"
      ? (collections?.find(({ id }) => id === member.mediaCollectionId)?.name ??
        "A collection")
      : (items.get(itemPath(member.mediaItemId))?.title ?? "A media item");
}

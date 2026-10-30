import { fileName } from "../../controls/formatting/file-name.js";
import type { MediaItem } from "../../http/contracts/media.js";
import { fileNote } from "../../media-availability/availability-label.js";

/**
 * Marks a member whose file is missing. It stays in the collection, since
 * missing status is temporary, but cannot air; the icon and text carry
 * that, so it never relies on color alone.
 */
export function MissingLabel() {
  return (
    <span className="warning-label">
      <span role="img" aria-label="Warning">
        ⚠
      </span>{" "}
      Missing — won't air until the file returns
    </span>
  );
}

/**
 * The file line for a member row that shows `MissingLabel`: the label
 * already says Missing, so the line names only the file rather than saying
 * it twice. Every other status keeps its availability word.
 */
export function memberFileNote(
  item: Pick<MediaItem, "status" | "path">,
): string {
  return item.status === "missing" ? fileName(item.path) : fileNote(item);
}

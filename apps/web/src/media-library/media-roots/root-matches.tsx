import { displayCount } from "../../controls/formatting/display-count.js";
import type { MediaRoot } from "../../http/contracts/media.js";

/**
 * A root's match counts in a few words: how much of it is matched, then
 * what still needs the owner, shown only when there is some. A root with no
 * media says so instead of "0 of 0 matched".
 */
export function RootMatches({
  counts,
  scanned,
}: {
  counts: MediaRoot["matchCounts"];
  scanned: boolean;
}) {
  if (counts.items === 0)
    return <>{scanned ? "No media found" : "Scan to find media"}</>;
  return (
    <>
      {displayCount(counts.matched)} of {displayCount(counts.items)} matched
      {counts.needsChoice > 0 && (
        <small className="secondary">
          {displayCount(counts.needsChoice)} need your choice
        </small>
      )}
      {counts.failedLookups > 0 && (
        <small className="secondary">
          {displayCount(counts.failedLookups)} failed{" "}
          {counts.failedLookups === 1 ? "lookup" : "lookups"}
        </small>
      )}
    </>
  );
}

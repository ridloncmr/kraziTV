import { Fragment } from "react";
import { TmdbAttribution } from "../../branding/tmdb-attribution.js";
import { displayTime } from "../../controls/display-time.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type { ContentMetadata, MediaItem } from "../../http/contracts.js";
import { useMutation } from "../../http/use-resource.js";
import { matchStateLabel } from "./match-state-label.js";
import { posterUrl } from "./poster-url.js";

/**
 * Shows one item's match state and accepted content facts. Only facts the
 * server reports appear; the poster loads from TMDB, and TMDB's notice shows
 * whenever TMDB facts do. Offers the match decisions the item's state allows:
 * choosing among candidates, rejecting a match, or clearing a rejection.
 */
export function MediaDetailsDialog({
  item,
  onChooseMatch,
  onChanged,
  onClose,
}: {
  item: MediaItem;
  /** Opens the candidate choice in place of this dialog. */
  onChooseMatch: () => void;
  /** A rejection or its clearing committed; the listed item is now stale. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const { metadata } = item;
  const decision = useMutation();
  const rejection = `${resourcePath("metadata/matches", item.id)}/rejection`;
  const facts: [string, string | null][] = [
    ["Match", matchStateLabel(metadata)],
    ["Lookup error", metadata.lookupError],
    ["Title", metadata.title],
    ["Series", metadata.seriesName],
    ["Episode", episodeLine(metadata)],
    ["Released", metadata.releaseDate],
    ["Genres", metadata.genres.join(", ") || null],
    ["Franchise", metadata.franchiseName],
  ];
  return (
    <WindowDialog
      title="Media details"
      busy={decision.pending}
      onClose={onClose}
    >
      <p>
        {item.title}
        <small className="secondary path-cell">{item.path}</small>
      </p>
      <div className="media-details">
        {metadata.posterPath && (
          <img
            className="media-poster"
            src={posterUrl(metadata.posterPath, "w342")}
            alt={`Poster for ${metadata.seriesName ?? metadata.title ?? item.title}`}
          />
        )}
        <dl className="facts">
          {facts
            .filter(([, value]) => value !== null)
            .map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
        </dl>
      </div>
      {metadata.description && <p>{metadata.description}</p>}
      {metadata.refreshedAt && (
        <>
          <p className="secondary">
            TMDB data refreshed {displayTime(metadata.refreshedAt)}
          </p>
          <TmdbAttribution />
        </>
      )}
      <RequestFeedback loading={decision.pending} error={decision.error} />
      <div className="dialog-actions">
        {metadata.matchState === "ambiguous" && (
          <button disabled={decision.pending} onClick={onChooseMatch}>
            Choose match…
          </button>
        )}
        {(metadata.matchState === "ambiguous" ||
          metadata.matchState === "matched") && (
          <button
            disabled={decision.pending}
            onClick={() =>
              void decision.run(rejection, "POST", undefined, onChanged)
            }
          >
            Reject match
          </button>
        )}
        {metadata.matchState === "rejected" && (
          <button
            disabled={decision.pending}
            onClick={() =>
              void decision.run(rejection, "DELETE", undefined, onChanged)
            }
          >
            Clear rejection
          </button>
        )}
        <button disabled={decision.pending} onClick={onClose}>
          Close
        </button>
      </div>
    </WindowDialog>
  );
}

/**
 * Describes an episode's place in its series, naming both ends of a
 * multi-episode file; season 0 is TMDB's specials season.
 */
function episodeLine(metadata: ContentMetadata): string | null {
  const { seasonNumber, episodeNumber, lastEpisodeNumber } = metadata;
  if (seasonNumber === null || episodeNumber === null) return null;
  const season = seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;
  const episodes =
    lastEpisodeNumber !== null && lastEpisodeNumber !== episodeNumber
      ? `episodes ${episodeNumber}–${lastEpisodeNumber}`
      : `episode ${episodeNumber}`;
  return `${season}, ${episodes}`;
}

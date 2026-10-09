import { Fragment } from "react";
import { TmdbAttribution } from "../../branding/tmdb-attribution.js";
import { displayTime } from "../../controls/display-time.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { ContentMetadata, MediaItem } from "../../http/contracts.js";
import { matchStateLabel } from "./match-state-label.js";

// TMDB serves posters by size from this base; kraziTV stores only the path.
const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

/**
 * Shows one item's match state and accepted content facts, read-only. Only
 * facts the server reports appear; the poster loads from TMDB, and TMDB's
 * notice shows whenever TMDB facts do.
 */
export function MediaDetailsDialog({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const { metadata } = item;
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
    <WindowDialog title="Media details" onClose={onClose}>
      <p>
        {item.title}
        <small className="secondary path-cell">{item.path}</small>
      </p>
      <div className="media-details">
        {metadata.posterPath && (
          <img
            className="media-poster"
            src={`${POSTER_BASE}${metadata.posterPath}`}
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
      <div className="dialog-actions">
        <button onClick={onClose}>Close</button>
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

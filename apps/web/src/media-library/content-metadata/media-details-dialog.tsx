import { Fragment, useState } from "react";
import { TmdbAttribution } from "../../branding/tmdb-attribution.js";
import { displayTime } from "../../controls/display-time.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type { ContentMetadata, MediaItem } from "../../http/contracts.js";
import { useMutation } from "../../http/use-resource.js";
import { CorrectDetailsDialog } from "./correct-details-dialog.js";
import { matchStateLabel } from "./match-state-label.js";
import { posterUrl } from "./poster-url.js";

/**
 * Shows one item's match state, effective content facts, and tags, marking
 * the facts the owner corrected. Only facts the server reports appear; the
 * poster loads from TMDB, and TMDB's notice shows whenever TMDB facts do.
 * Offers the match decisions the item's state allows: choosing among
 * candidates, rejecting a match, or clearing a rejection. Correcting details
 * is offered in every state, and a lookup retry for any available item that
 * is not an extra, which a retry never changes.
 */
export function MediaDetailsDialog({
  item,
  onChooseMatch,
  onRetry,
  onChanged,
  onCorrected,
  onClose,
}: {
  item: MediaItem;
  /** Opens the candidate choice in place of this dialog. */
  onChooseMatch: () => void;
  /** Looks this item, or every item in its folder, up on TMDB again. */
  onRetry: (scope: "item" | "folder") => void;
  /** A rejection or its clearing committed; the listed item is now stale. */
  onChanged: () => void;
  /** A correction committed; `corrected` is the item as now shown. */
  onCorrected: (corrected: MediaItem) => void;
  onClose: () => void;
}) {
  const { metadata } = item;
  const decision = useMutation();
  const rejection = `${resourcePath("metadata/matches", item.id)}/rejection`;
  const [correcting, setCorrecting] = useState(false);
  const corrected = new Set(metadata.correctedFields);
  // Each fact with whether the owner's correction decides it.
  const facts: [string, string | null, boolean?][] = [
    ["Match", matchStateLabel(metadata)],
    ["Lookup error", metadata.lookupError],
    ["Title", metadata.title, corrected.has("title")],
    ["Series", metadata.seriesName, corrected.has("seriesName")],
    [
      "Episode",
      episodeLine(metadata),
      corrected.has("seasonNumber") || corrected.has("episodeNumber"),
    ],
    ["Released", metadata.releaseDate],
    ["Genres", metadata.genres.join(", ") || null],
    ["Franchise", metadata.franchiseName],
    ["Tags", metadata.tags.join(", ") || null],
  ];
  if (correcting) {
    return (
      <CorrectDetailsDialog
        item={item}
        onCorrected={(next) => {
          setCorrecting(false);
          onCorrected(next);
        }}
        onClose={() => setCorrecting(false)}
      />
    );
  }
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
            .map(([label, value, byOwner]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  {byOwner && (
                    <small className="secondary"> (your correction)</small>
                  )}
                </dd>
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
        <button disabled={decision.pending} onClick={() => setCorrecting(true)}>
          Correct details…
        </button>
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
        {item.status === "available" && metadata.matchState !== "extra" && (
          <>
            <button disabled={decision.pending} onClick={() => onRetry("item")}>
              Retry lookup
            </button>
            <button
              disabled={decision.pending}
              onClick={() => onRetry("folder")}
            >
              Retry folder lookups
            </button>
          </>
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

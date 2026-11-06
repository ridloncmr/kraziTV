import { Fragment, useState } from "react";
import { TmdbAttribution } from "../../branding/attribution/tmdb-attribution.js";
import { displayTime } from "../../controls/formatting/display-time.js";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import { WindowDialog } from "../../controls/dialogs/window-dialog.js";
import { Poster } from "../../controls/poster/poster.js";
import { resourcePath } from "../../http/api-client.js";
import type { ContentMetadata, MediaItem } from "../../http/contracts/media.js";
import type { TrackFolder } from "../../http/contracts/metadata.js";
import { useMutation, useResource } from "../../http/resources/use-resource.js";
import { CorrectDetailsDialog } from "./correct-details-dialog.js";
import { matchStateLabel, tmdbFailureWords } from "./match-state-label.js";
import { posterUrl } from "./poster-url.js";

/**
 * Shows one item's match state, effective content facts, and tags, marking
 * the facts the owner corrected. Only facts the server reports appear; the
 * poster loads from TMDB, and TMDB's notice shows whenever TMDB facts do.
 * An item whose TMDB data expired says so, and says the key must be accepted
 * first when its refresh failed on a rejected key. A file that could not be read, a
 * failed lookup, and a failed background refresh each read as one owner
 * sentence beside the match, with the stored text only as a tooltip; a
 * TMDB failure's sentence says whether the key or TMDB's reach is at fault.
 * Offers the match decisions the item's state allows: choosing among
 * candidates, rejecting a match, or clearing a rejection. Correcting details
 * is offered in every state, and a lookup retry for any available item that
 * is not an extra, which a retry never changes. A file changed since it was
 * matched says so and offers keeping the match; correcting it also clears
 * the flag. A disc-track file with no decision and no corrections offers
 * mapping its folder's tracks to episodes when the server can: it refuses
 * without a TMDB key, and for any file that is no disc track.
 */
export function MediaDetailsDialog({
  item,
  onChooseMatch,
  onMapTracks,
  onRetry,
  onChanged,
  onUpdated,
  onClose,
}: {
  item: MediaItem;
  /** Opens the candidate choice in place of this dialog. */
  onChooseMatch: () => void;
  /** Opens the track mapping in place of this dialog. */
  onMapTracks: () => void;
  /** Looks this item, or every item in its folder, up on TMDB again. */
  onRetry: (scope: "item" | "folder") => void;
  /** A rejection or its clearing committed; the listed item is now stale. */
  onChanged: () => void;
  /** A correction or kept match committed; `updated` is the item as now shown. */
  onUpdated: (updated: MediaItem) => void;
  onClose: () => void;
}) {
  const { metadata } = item;
  const decision = useMutation();
  const rejection = `${resourcePath("metadata/matches", item.id)}/rejection`;
  const keep = `${resourcePath("metadata/matches", item.id)}/keep`;
  const [correcting, setCorrecting] = useState(false);
  // Only a file nothing has decided yet asks; a refusal just hides the offer.
  const unresolved =
    metadata.matchState === "not_looked_up" &&
    metadata.correctedFields.length === 0;
  const trackFolder = useResource<TrackFolder>(
    unresolved ? resourcePath("metadata/track-mappings", item.id) : null,
  );
  const corrected = new Set(metadata.correctedFields);
  // Each fact with whether the owner's correction decides it. A failure is
  // one owner sentence saying what to do; the stored text stays as its
  // tooltip.
  const facts: Fact[] = [
    { label: "Match", value: matchStateLabel(metadata) },
    failureFact("Why", item.probeError, "kraziTV could not read this file"),
    failureFact(
      "Lookup error",
      metadata.lookupError,
      tmdbFailureWords(metadata.lookupErrorKind),
    ),
    failureFact(
      "Refresh error",
      metadata.refreshError,
      tmdbFailureWords(metadata.refreshErrorKind),
    ),
    { label: "Title", value: metadata.title, byOwner: corrected.has("title") },
    {
      label: "Series",
      value: metadata.seriesName,
      byOwner: corrected.has("seriesName"),
    },
    {
      label: "Episode",
      value: episodeLine(metadata),
      byOwner: corrected.has("seasonNumber") || corrected.has("episodeNumber"),
    },
    {
      label: "Released",
      value: metadata.releaseDate,
      byOwner: corrected.has("releaseYear"),
    },
    { label: "Genres", value: metadata.genres.join(", ") || null },
    { label: "Franchise", value: metadata.franchiseName },
    { label: "Tags", value: metadata.tags.join(", ") || null },
  ];
  if (correcting) {
    return (
      <CorrectDetailsDialog
        item={item}
        onCorrected={(next) => {
          setCorrecting(false);
          onUpdated(next);
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
          <Poster
            className="media-poster"
            src={posterUrl(metadata.posterPath, "w342")}
            alt={`Poster for ${metadata.seriesName ?? metadata.title ?? item.title}`}
          />
        )}
        <dl className="facts">
          {facts
            .filter((fact) => fact.value !== null)
            .map(({ label, value, byOwner, stored }) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd title={stored ?? undefined}>
                  {value}
                  {byOwner && (
                    <small className="secondary"> (your correction)</small>
                  )}
                </dd>
              </Fragment>
            ))}
        </dl>
      </div>
      {metadata.fileChanged && (
        <p role="status">File changed since it was matched</p>
      )}
      {metadata.description && <p>{metadata.description}</p>}
      {metadata.refreshedAt && (
        <>
          <p className="secondary">
            {metadata.tmdbDataExpired ? (
              metadata.refreshErrorKind === "key_rejected" ? (
                <>
                  TMDB data expired. It will refresh once TMDB accepts the key
                  in Account Settings.
                </>
              ) : (
                <>TMDB data expired. It will refresh when TMDB is reachable.</>
              )
            ) : (
              <>TMDB data refreshed {displayTime(metadata.refreshedAt)}</>
            )}
          </p>
          <TmdbAttribution />
        </>
      )}
      <RequestFeedback loading={decision.pending} error={decision.error} />
      <div className="dialog-actions">
        {metadata.fileChanged && (
          <button
            disabled={decision.pending}
            onClick={() =>
              void decision.run(keep, "POST", undefined, onUpdated)
            }
          >
            Keep match
          </button>
        )}
        <button disabled={decision.pending} onClick={() => setCorrecting(true)}>
          Correct details…
        </button>
        {metadata.matchState === "ambiguous" && (
          <button disabled={decision.pending} onClick={onChooseMatch}>
            Choose match…
          </button>
        )}
        {trackFolder.data && (
          <button disabled={decision.pending} onClick={onMapTracks}>
            Map tracks to episodes…
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

/** One row of the facts list; a fact whose value is null is not shown. */
interface Fact {
  label: string;
  value: string | null;
  /** Whether the owner's correction decides the value. */
  byOwner?: boolean;
  /** The stored failure text the value stands in for, shown as a tooltip. */
  stored?: string | null;
}

/**
 * A failure fact reads `sentence` only while the server stores a failure;
 * the stored text itself names codes and HTTP answers the owner cannot act
 * on, so it is kept only as the tooltip.
 */
function failureFact(
  label: string,
  stored: string | null,
  sentence: string,
): Fact {
  return { label, value: stored === null ? null : sentence, stored };
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

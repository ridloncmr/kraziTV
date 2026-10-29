import { useEffect, useRef, useState } from "react";
import { TmdbAttribution } from "../../branding/attribution/tmdb-attribution.js";
import { displayDuration } from "../../controls/formatting/display-duration.js";
import { formText } from "../../controls/formatting/form-text.js";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import { WindowDialog } from "../../controls/dialogs/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaItem } from "../../http/contracts/media.js";
import type {
  CandidateSearch,
  MatchCandidates,
} from "../../http/contracts/metadata.js";
import { useMutation, useResource } from "../../http/resources/use-resource.js";
import { CorrectDetailsDialog } from "./correct-details-dialog.js";
import { posterUrl } from "./poster-url.js";

/** How a candidate choice ended for its item. */
export type ChoiceOutcome =
  "chosen" | "corrected" | "rejected" | "skipped" | "gone";

/** The codes a candidate read answers with once the item no longer needs a choice. */
const GONE_CODES = new Set(["match_not_ambiguous", "media_item_not_found"]);

/**
 * Asks the owner which TMDB result an ambiguous item is, showing each
 * candidate's poster and year beside the file's probed duration, and its
 * runtime on request. When none fits, the owner searches TMDB in their own
 * words, with an optional year, and chooses from what it finds, or corrects
 * the item's details by hand instead. Choosing commits at once; **None of
 * these** rejects the match. In a walk-through, `step` names its place and
 * adds **Skip**, and an item settled since the walk-through began reports
 * `gone` without asking.
 */
export function MatchChoiceDialog({
  mediaItemId,
  title,
  step,
  onDecided,
  onClose,
}: {
  mediaItemId: string;
  /** The series or movie name the choice is about. */
  title: string;
  /** A walk-through's place, such as `Step 2 of 5`. */
  step?: string;
  onDecided: (outcome: ChoiceOutcome) => void;
  onClose: () => void;
}) {
  const match = resourcePath("metadata/matches", mediaItemId);
  const offer = useResource<MatchCandidates>(`${match}/candidates`);
  const decision = useMutation();
  const [query, setQuery] = useState<string>();
  const search = useResource<CandidateSearch>(
    query === undefined ? null : `${match}/search?${query}`,
  );
  const [correcting, setCorrecting] = useState(false);
  // The correction form needs the item as shown, read only once asked for.
  const item = useResource<MediaItem>(
    correcting ? resourcePath("media-items", mediaItemId) : null,
  );
  const gone =
    offer.error instanceof ApiError && GONE_CODES.has(offer.error.code);
  // Reported once, so a re-render before the walk-through moves on never skips a second step.
  const reported = useRef(false);
  useEffect(() => {
    if (!gone || step === undefined || reported.current) return;
    reported.current = true;
    onDecided("gone");
  }, [gone, step, onDecided]);
  const pending = decision.pending;
  const choose = (tmdbId: number) =>
    void decision.run(`${match}/choice`, "POST", { tmdbId }, () =>
      onDecided("chosen"),
    );

  if (correcting) {
    return item.data ? (
      <CorrectDetailsDialog
        item={item.data}
        onCorrected={() => onDecided("corrected")}
        onClose={() => setCorrecting(false)}
      />
    ) : (
      <WindowDialog
        title="Correct details"
        onClose={() => setCorrecting(false)}
      >
        <RequestFeedback loading={item.loading} error={item.error} />
        <div className="dialog-actions">
          <button onClick={() => setCorrecting(false)}>Cancel</button>
        </div>
      </WindowDialog>
    );
  }
  return (
    <WindowDialog title="Choose a match" busy={pending} onClose={onClose}>
      {step && <p className="secondary">{step}</p>}
      <p>
        Which {offer.data?.kind === "series" ? "series" : "title"} is{" "}
        <strong>{title}</strong>?
        {offer.data && (
          <small className="secondary">
            This file runs {displayDuration(offer.data.durationMs)}.
          </small>
        )}
      </p>
      <RequestFeedback
        loading={offer.loading || pending}
        error={decision.error ?? offer.error}
      />
      {offer.data && (
        <CandidateList
          candidates={offer.data.candidates}
          runtimePath={`${match}/candidates`}
          pending={pending}
          onChoose={choose}
        />
      )}
      {offer.data && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const params = new URLSearchParams({
              title: formText(values, "title").trim(),
            });
            const year = formText(values, "year").trim();
            if (year !== "") params.set("year", year);
            setQuery(params.toString());
          }}
        >
          <label>
            Not here? Search TMDB
            <input name="title" defaultValue={title} required />
          </label>
          <label>
            Year
            <input name="year" type="number" min={1878} step={1} />
          </label>
          <button type="submit" disabled={pending || search.loading}>
            Search
          </button>
        </form>
      )}
      {query !== undefined && (
        <RequestFeedback loading={search.loading} error={search.error} />
      )}
      {search.data &&
        (search.data.candidates.length === 0 ? (
          <p role="status">TMDB found nothing for that.</p>
        ) : (
          <CandidateList
            candidates={search.data.candidates}
            runtimePath={`${match}/candidates`}
            pending={pending}
            onChoose={choose}
          />
        ))}
      {offer.data && <TmdbAttribution />}
      <div className="dialog-actions">
        {step && (
          <button disabled={pending} onClick={() => onDecided("skipped")}>
            Skip
          </button>
        )}
        <button disabled={pending} onClick={() => setCorrecting(true)}>
          Correct details…
        </button>
        <button
          disabled={pending || !offer.data}
          onClick={() =>
            void decision.run(`${match}/rejection`, "POST", undefined, () =>
              onDecided("rejected"),
            )
          }
        >
          None of these
        </button>
        <button disabled={pending} onClick={onClose}>
          Close
        </button>
      </div>
    </WindowDialog>
  );
}

/**
 * Lists candidates, offered or searched, each with its poster, year, and
 * runtime on request, and a button to choose it.
 */
function CandidateList({
  candidates,
  runtimePath,
  pending,
  onChoose,
}: {
  candidates: MatchCandidates["candidates"];
  /** The candidates path whose `/:tmdbId/runtime` reads a runtime. */
  runtimePath: string;
  pending: boolean;
  onChoose: (tmdbId: number) => void;
}) {
  return (
    <ul className="match-candidates">
      {candidates.map((candidate) => {
        const name = `${candidate.title} (${candidate.releaseDate?.slice(0, 4) ?? "year unknown"})`;
        return (
          <li key={candidate.tmdbId}>
            {candidate.posterPath && (
              <img
                src={posterUrl(candidate.posterPath, "w92")}
                alt={`Poster for ${name}`}
              />
            )}
            <div>
              <strong>{name}</strong>
              <CandidateRuntime
                path={`${runtimePath}/${candidate.tmdbId}/runtime`}
                name={name}
              />
            </div>
            <button
              aria-label={`Choose ${name}`}
              disabled={pending}
              onClick={() => onChoose(candidate.tmdbId)}
            >
              Choose
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Shows one candidate's TMDB runtime only once the owner asks, so opening a
 * choice costs no TMDB calls and each comparison costs one. A failed read
 * shows the runtime as unknown: it only helps a choice.
 */
function CandidateRuntime({ path, name }: { path: string; name: string }) {
  const [asked, setAsked] = useState(false);
  const runtime = useResource<{ runtimeMs: number | null }>(
    asked ? path : null,
  );
  if (!asked) {
    return (
      <button
        aria-label={`Show runtime of ${name}`}
        onClick={() => setAsked(true)}
      >
        Show runtime
      </button>
    );
  }
  const runtimeMs = runtime.data?.runtimeMs;
  return (
    <small className="secondary">
      Runtime{" "}
      {runtime.loading
        ? "…"
        : runtimeMs === undefined || runtimeMs === null
          ? "unknown"
          : displayDuration(runtimeMs)}
    </small>
  );
}

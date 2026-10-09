import { useEffect, useRef, useState } from "react";
import { TmdbAttribution } from "../../branding/tmdb-attribution.js";
import { displayDuration } from "../../controls/display-duration.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { MatchCandidates } from "../../http/contracts.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { posterUrl } from "./poster-url.js";

/** How a candidate choice ended for its item. */
export type ChoiceOutcome = "chosen" | "rejected" | "skipped" | "gone";

/** The codes a candidate read answers with once the item no longer needs a choice. */
const GONE_CODES = new Set(["match_not_ambiguous", "media_item_not_found"]);

/**
 * Asks the owner which TMDB result an ambiguous item is, showing each
 * candidate's poster and year beside the file's probed duration, and its
 * runtime on request.
 * Choosing commits at once; **None of these** rejects the match. In a
 * walk-through, `step` names its place and adds **Skip**, and an item settled
 * since the walk-through began reports `gone` without asking.
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
        <ul className="match-candidates">
          {offer.data.candidates.map((candidate) => {
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
                    path={`${match}/candidates/${candidate.tmdbId}/runtime`}
                    name={name}
                  />
                </div>
                <button
                  aria-label={`Choose ${name}`}
                  disabled={pending}
                  onClick={() =>
                    void decision.run(
                      `${match}/choice`,
                      "POST",
                      { tmdbId: candidate.tmdbId },
                      () => onDecided("chosen"),
                    )
                  }
                >
                  Choose
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {offer.data && <TmdbAttribution />}
      <div className="dialog-actions">
        {step && (
          <button disabled={pending} onClick={() => onDecided("skipped")}>
            Skip
          </button>
        )}
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

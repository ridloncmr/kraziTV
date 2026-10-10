import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { ReviewStep } from "../../http/contracts.js";
import { useResource } from "../../http/use-resource.js";
import {
  MatchChoiceDialog,
  type ChoiceOutcome,
} from "./match-choice-dialog.js";

/** What the walk-through counts on its last page. */
type Tally = Record<Exclude<ChoiceOutcome, "gone">, number>;

/**
 * Walks the owner through every item needing a choice, one step at a time:
 * one step per series folder or movie file. Each choice commits as it is
 * made, so closing early keeps every earlier one. Steps are read once when
 * the dialog opens; a step settled since then is dropped uncounted.
 */
export function ReviewMatchesDialog({ onClose }: { onClose: () => void }) {
  const review = useResource<{ steps: ReviewStep[] }>(
    "/metadata/match-reviews",
  );
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState<Tally>({
    chosen: 0,
    rejected: 0,
    skipped: 0,
  });
  const steps = review.data?.steps;
  const step = steps?.[index];
  if (steps && step) {
    return (
      <MatchChoiceDialog
        key={step.mediaItemId}
        mediaItemId={step.mediaItemId}
        title={step.title}
        step={`Step ${index + 1} of ${steps.length}`}
        onDecided={(outcome) => {
          if (outcome !== "gone") {
            setTally((counts) => ({
              ...counts,
              [outcome]: counts[outcome] + 1,
            }));
          }
          setIndex((current) => current + 1);
        }}
        onClose={onClose}
      />
    );
  }
  return (
    <WindowDialog title="Review matches" onClose={onClose}>
      <RequestFeedback loading={review.loading} error={review.error} />
      {steps && (
        <>
          <p>All done.</p>
          <dl className="facts">
            <dt>Chosen</dt>
            <dd>{tally.chosen}</dd>
            <dt>Rejected</dt>
            <dd>{tally.rejected}</dd>
            <dt>Skipped</dt>
            <dd>{tally.skipped}</dd>
          </dl>
        </>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>Close</button>
      </div>
    </WindowDialog>
  );
}

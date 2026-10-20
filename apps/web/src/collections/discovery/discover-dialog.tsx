import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type {
  MediaCollection,
  Recommendation,
} from "../../http/contracts/collections.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { ReadOnlyMembers } from "../editor/read-only-members.js";

const RECOMMENDATIONS = "/media-collections/recommendations";

/**
 * Suggests series and franchise collections inside the Collections program,
 * each with why it was suggested, its member count (and a series' season
 * count), and its members. Nothing
 * becomes a collection until the owner accepts it, as automatic (the primary
 * action) or as a manual snapshot. A dismissal holds until restored under
 * Show dismissed; the server computes and decides everything.
 */
export function DiscoverDialog({
  created,
  onClose,
}: {
  created: (collection: MediaCollection) => void;
  onClose: () => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const recommendations = useResource<Recommendation[]>(
    showDismissed ? `${RECOMMENDATIONS}?dismissed=true` : RECOMMENDATIONS,
  );
  const mutation = useMutation();

  /** Accepts a recommendation as an automatic or manual collection, then opens it. */
  function accept(
    recommendation: Recommendation,
    mode: "automatic" | "manual",
  ) {
    void mutation.run<MediaCollection>(
      `${RECOMMENDATIONS}/acceptance`,
      "POST",
      { criterion: recommendation.criterion, mode },
      created,
    );
  }

  /** Dismisses or restores a recommendation, then rereads the list it left. */
  function decide(
    recommendation: Recommendation,
    action: "dismissal" | "restoration",
  ) {
    void mutation.run(
      `${RECOMMENDATIONS}/${action}`,
      "POST",
      { criterion: recommendation.criterion },
      recommendations.refresh,
    );
  }

  return (
    <WindowDialog
      title="Discover collections"
      busy={mutation.pending}
      onClose={onClose}
    >
      <p>
        Suggested from your catalog: TV series and movie franchises with several
        cataloged items. Nothing is created until you choose.
      </p>
      <p>
        An automatic collection keeps itself up to date: episodes and movies you
        catalog later join it in order. A manual collection is a snapshot that
        changes only when you edit it.
      </p>
      <label className="choice">
        <input
          type="checkbox"
          checked={showDismissed}
          onChange={(event) => setShowDismissed(event.target.checked)}
        />
        Show dismissed
      </label>
      <RequestFeedback
        loading={recommendations.loading || mutation.pending}
        error={mutation.error ?? recommendations.error}
      />
      {recommendations.data?.length === 0 && (
        <p className="empty-state">
          {showDismissed
            ? "Nothing is dismissed."
            : "No suggestions right now. Series and franchises appear here once TMDB matches several of their items."}
        </p>
      )}
      <ul className="recommendation-list">
        {recommendations.data?.map((recommendation) => (
          <li
            key={`${recommendation.criterion.kind}:${recommendation.criterion.tmdbId}`}
          >
            <strong>{recommendation.name}</strong>
            <span className="secondary">{recommendation.reason}</span>
            <span className="secondary">
              {recommendation.memberCount}{" "}
              {recommendation.memberCount === 1 ? "item" : "items"}
              {recommendation.seasonCount !== null &&
                `, ${recommendation.seasonCount} ${recommendation.seasonCount === 1 ? "season" : "seasons"}`}
            </span>
            <details>
              <summary>Show members</summary>
              <ReadOnlyMembers members={recommendation.members} />
            </details>
            <div className="row-actions">
              {showDismissed ? (
                <button
                  disabled={mutation.pending}
                  aria-label={`Restore ${recommendation.name}`}
                  onClick={() => decide(recommendation, "restoration")}
                >
                  Restore
                </button>
              ) : recommendation.collectionId !== null ? (
                <span>Already created</span>
              ) : (
                <>
                  <button
                    disabled={mutation.pending}
                    aria-label={`Create automatic collection from ${recommendation.name}`}
                    onClick={() => accept(recommendation, "automatic")}
                  >
                    <strong>Create automatic collection</strong>
                  </button>
                  <button
                    disabled={mutation.pending}
                    aria-label={`Save ${recommendation.name} as a manual collection`}
                    onClick={() => accept(recommendation, "manual")}
                  >
                    Save as manual collection
                  </button>
                  <button
                    disabled={mutation.pending}
                    aria-label={`Dismiss ${recommendation.name}`}
                    onClick={() => decide(recommendation, "dismissal")}
                  >
                    Dismiss
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button disabled={mutation.pending} onClick={onClose}>
          Close
        </button>
      </div>
    </WindowDialog>
  );
}

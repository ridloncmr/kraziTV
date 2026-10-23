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
 * action) or as a manual snapshot. Accepting keeps the dialog open so several
 * can be created in one visit; the server stops listing one an automatic
 * collection now maintains. A dismissal holds until restored under Show
 * dismissed; the server computes and decides everything.
 */
export function DiscoverDialog({
  onCreated,
  onClose,
}: {
  /** Tells the Collections program a collection was created behind the dialog. */
  onCreated: () => void;
  onClose: () => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [notice, setNotice] = useState("");
  // How each recommendation accepted in this visit was saved, so it leaves or
  // relabels at once instead of waiting for the list to reload.
  const [accepted, setAccepted] = useState<
    Record<string, "automatic" | "manual">
  >({});
  const recommendations = useResource<Recommendation[]>(
    showDismissed ? `${RECOMMENDATIONS}?dismissed=true` : RECOMMENDATIONS,
  );
  const listed = recommendations.data?.filter(
    (recommendation) =>
      accepted[recommendationKey(recommendation)] !== "automatic",
  );
  const mutation = useMutation();

  /** Accepts a recommendation as an automatic or manual collection, then rereads the list so the next can be chosen. */
  function accept(
    recommendation: Recommendation,
    mode: "automatic" | "manual",
  ) {
    setNotice("");
    void mutation.run<MediaCollection>(
      `${RECOMMENDATIONS}/acceptance`,
      "POST",
      { criterion: recommendation.criterion, mode },
      (collection) => {
        setAccepted((current) => ({
          ...current,
          [recommendationKey(recommendation)]: mode,
        }));
        setNotice(
          `Created ${collection.name} as ${mode === "automatic" ? "an automatic" : "a manual"} collection.`,
        );
        recommendations.refresh();
        onCreated();
      },
    );
  }

  /** Dismisses or restores a recommendation, then rereads the list it left. */
  function decide(
    recommendation: Recommendation,
    action: "dismissal" | "restoration",
  ) {
    setNotice("");
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
        message={notice}
      />
      {listed?.length === 0 && (
        <p className="empty-state">
          {showDismissed
            ? "Nothing is dismissed."
            : "No suggestions right now. Series and franchises appear here once TMDB matches several of their items."}
        </p>
      )}
      <ul className="recommendation-list">
        {listed?.map((recommendation) => (
          <li key={recommendationKey(recommendation)}>
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
              ) : recommendation.collectionId !== null ||
                accepted[recommendationKey(recommendation)] === "manual" ? (
                <span>Saved as a manual collection</span>
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

/** Identifies a recommendation by its criterion, which the server keeps unique. */
function recommendationKey({ criterion }: Recommendation): string {
  return `${criterion.kind}:${criterion.tmdbId}`;
}

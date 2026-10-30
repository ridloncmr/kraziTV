import { useId } from "react";
import {
  type FoundMember,
  memberKey,
} from "../../media-search/collection-or-item-search.js";

/**
 * The picks Add shows holds, counted in the caption and listed in the
 * order picked, which is the order a wheel plays them. It stays in sight
 * whatever the search shows, so a pick a new search hides can still be
 * seen and removed.
 */
export function SelectedPicks({
  picks,
  onRemove,
}: {
  picks: readonly FoundMember[];
  onRemove: (pick: FoundMember) => void;
}) {
  const captionId = useId();
  return (
    <div className="field-group">
      <span id={captionId}>
        {picks.length === 0 ? "Selected" : `Selected (${picks.length})`}
      </span>
      {picks.length === 0 ? (
        <p className="secondary">
          Nothing selected yet. Check collections or single items above.
        </p>
      ) : (
        <ol aria-labelledby={captionId} className="member-list selected-picks">
          {picks.map((pick) => (
            <li key={memberKey(pick.member)} className="inline-form">
              <span>
                {pick.name} <small className="secondary">{pick.detail}</small>
              </span>
              <button
                type="button"
                aria-label={`Remove ${pick.name}`}
                onClick={() => onRemove(pick)}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

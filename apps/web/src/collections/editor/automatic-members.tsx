import { useState } from "react";
import { displayDuration } from "../../controls/display-duration.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import type {
  CollectionMember,
  ExcludedItem,
} from "../../http/contracts/collections.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { ReadOnlyMembers } from "./read-only-members.js";

/**
 * An automatic collection's members with its exclusions: the owner can keep
 * a member out, show what is excluded, and restore inclusion. The server
 * decides the resulting membership, including whether a restored item
 * still matches; `changed` refreshes every view of it.
 */
export function AutomaticMembers({
  path,
  members,
  visible,
  changed,
}: {
  path: string;
  members: readonly CollectionMember[];
  visible: boolean;
  changed: () => void;
}) {
  const mutation = useMutation();
  const [showExcluded, setShowExcluded] = useState(false);
  const excluded = useResource<ExcludedItem[]>(
    showExcluded ? `${path}/exclusions` : null,
    visible,
  );

  /** Excludes or restores one item, then refreshes the exclusions and every membership view. */
  function decide(mediaItemId: string, method: "PUT" | "DELETE") {
    void mutation.run(
      `${path}/exclusions/${encodeURIComponent(mediaItemId)}`,
      method,
      undefined,
      () => {
        excluded.refresh();
        changed();
      },
    );
  }

  return (
    <>
      <RequestFeedback
        loading={mutation.pending || excluded.loading}
        error={mutation.error ?? excluded.error}
      />
      <ReadOnlyMembers
        members={members}
        exclude={{
          run: (member) => decide(member.mediaItemId, "PUT"),
          disabled: mutation.pending,
        }}
      />
      <label className="choice">
        <input
          type="checkbox"
          checked={showExcluded}
          onChange={(event) => setShowExcluded(event.target.checked)}
        />
        Show excluded
      </label>
      {showExcluded &&
        excluded.data &&
        (excluded.data.length === 0 ? (
          <p className="empty-state">Nothing is excluded.</p>
        ) : (
          <div className="table-scroll">
            <table aria-label="Excluded media">
              <thead>
                <tr>
                  <th>Title / path</th>
                  <th>Duration</th>
                  <th>Matches</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {excluded.data.map((item) => (
                  <tr key={item.mediaItemId} className="excluded-row">
                    <td>
                      <strong className="excluded-label">Excluded</strong>{" "}
                      {item.title}
                      <small className="secondary path-cell">{item.path}</small>
                    </td>
                    <td>{displayDuration(item.durationMs)}</td>
                    <td>
                      {item.qualifies === null
                        ? "Unknown — its TMDB data expired"
                        : item.qualifies
                          ? "Still matches"
                          : "No longer matches"}
                    </td>
                    <td>
                      <button
                        aria-label={`Restore inclusion of ${item.title}`}
                        disabled={mutation.pending}
                        onClick={() => decide(item.mediaItemId, "DELETE")}
                      >
                        Restore inclusion
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}

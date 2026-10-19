import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { useMutation } from "../../http/use-resource.js";
import { AssignmentForm } from "../assignments/assignment-form.js";
import { MarathonSettingsForm } from "./marathon-settings-form.js";
import type { ChannelProgramming } from "../use-channel-programming.js";

/**
 * The Lineup tab: the channel's programming source assignments in saved
 * order, which new rounds are formed from, with editing, adding, removing,
 * reordering, and the channel's marathon settings. Every accepted write
 * calls `changed`; the server regenerates.
 */
export function LineupTab({
  programming,
  visible,
}: {
  programming: ChannelProgramming;
  visible: boolean;
}) {
  const { assignments, collections, assignmentsPath, changed } = programming;
  const reorder = useMutation();
  const [adding, setAdding] = useState(false);
  // Remounts the add form after each addition, so it starts empty again.
  const [added, setAdded] = useState(0);
  const listed = assignments.data ?? [];
  // Moves one assignment a place earlier or later in saved order.
  const move = (index: number, offset: -1 | 1) => {
    const ids = listed.map((assignment) => assignment.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + offset, 0, moved);
    void reorder.run(
      `${assignmentsPath}/order`,
      "PUT",
      { assignmentIds: ids },
      changed,
    );
  };
  return (
    <section aria-label="Lineup">
      <RequestFeedback
        loading={assignments.loading || collections.loading || reorder.pending}
        error={reorder.error ?? assignments.error ?? collections.error}
      />
      {assignments.data?.length === 0 && (
        <p className="empty-state">
          No programming assigned. Choose one source to begin broadcasting.
        </p>
      )}
      {listed.length > 1 && (
        <p className="secondary">
          Each round gives every assignment one turn, in a freshly shuffled
          order, and no assignment airs twice in a row while another can.
        </p>
      )}
      <ol aria-label="Programming assignments">
        {listed.map((assignment, index) => (
          <li key={assignment.id}>
            <AssignmentForm
              assignmentsPath={assignmentsPath}
              assignment={assignment}
              legend={`Assignment ${index + 1}`}
              collections={collections.data}
              visible={visible}
              changed={changed}
            />
            {listed.length > 1 && (
              <div className="row-actions">
                <button
                  type="button"
                  disabled={index === 0 || reorder.pending}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={index === listed.length - 1 || reorder.pending}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {assignments.data && (listed.length === 0 || adding) ? (
        <AssignmentForm
          key={`new-${added}`}
          assignmentsPath={assignmentsPath}
          legend="New assignment"
          collections={collections.data}
          visible={visible}
          changed={() => {
            setAdding(false);
            setAdded((count) => count + 1);
            changed();
          }}
        />
      ) : (
        assignments.data && (
          <button type="button" onClick={() => setAdding(true)}>
            Add an assignment
          </button>
        )
      )}
      {listed.length > 0 && (
        <MarathonSettingsForm
          path={`${programming.channelPath}/programming-settings`}
          visible={visible}
          marathonsAllowed={listed.some(
            (assignment) => assignment.marathonStretch !== null,
          )}
          changed={changed}
        />
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type {
  MediaCollection,
  ScheduleWindow,
  SourceAssignment,
} from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { scheduleWindowPath } from "../schedule-view/schedule-window-path.js";
import { AssignmentForm } from "./assignment-form.js";
import { MarathonSettingsForm } from "./marathon-settings-form.js";
import { UpcomingProgramming } from "./upcoming-programming.js";

/**
 * Lists the channel's programming source assignments in saved order, which
 * new rounds are formed from, and lets the owner edit, add, remove, and
 * reorder them. Every accepted write refreshes the list and the backend
 * schedule observation; the server regenerates.
 */
export function ProgrammingEditor({
  channelId,
  visible,
}: {
  channelId: string;
  visible: boolean;
}) {
  const path = `${resourcePath("channels", channelId)}/programming-assignments`;
  const assignments = useResource<SourceAssignment[]>(path, visible);
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const reorder = useMutation();
  const [adding, setAdding] = useState(false);
  // Remounts the add form after each addition, so it starts empty again.
  const [added, setAdded] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const schedulePath = useMemo(
    () => scheduleWindowPath(channelId),
    [channelId, visible],
  );
  const schedule = useResource<ScheduleWindow>(
    showSchedule ? schedulePath : null,
    visible,
  );
  // Counts accepted writes, so the upcoming programming is read again.
  const [changes, setChanges] = useState(0);
  // Refreshes what every write can change: the list, preview, and schedule.
  const changed = () => {
    setChanges((count) => count + 1);
    assignments.refresh();
    setShowSchedule(true);
    schedule.refresh();
  };
  const listed = assignments.data ?? [];
  // Moves one assignment a place earlier or later in saved order.
  const move = (index: number, offset: -1 | 1) => {
    const ids = listed.map((assignment) => assignment.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + offset, 0, moved);
    void reorder.run(`${path}/order`, "PUT", { assignmentIds: ids }, changed);
  };
  return (
    <section aria-label="Programming">
      <h3>Programming</h3>
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
              assignmentsPath={path}
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
          assignmentsPath={path}
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
          path={`${resourcePath("channels", channelId)}/programming-settings`}
          visible={visible}
          marathonsAllowed={listed.some(
            (assignment) => assignment.marathonStretch !== null,
          )}
          changed={changed}
        />
      )}
      {listed.length > 0 && (
        <UpcomingProgramming
          key={`preview-${changes}`}
          path={`${resourcePath("channels", channelId)}/programming-preview`}
          visible={visible}
          collections={collections.data}
        />
      )}
      {showSchedule && (
        <>
          <RequestFeedback loading={schedule.loading} error={schedule.error} />
          {schedule.data && (
            <p>
              Backend schedule: {schedule.data.entries.length} entries ·
              revision {schedule.data.scheduleRevision}. Open Program Guide to
              inspect air times.
            </p>
          )}
        </>
      )}
    </section>
  );
}

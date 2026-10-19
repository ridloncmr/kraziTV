import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { rowClickProps } from "../../controls/row-click.js";
import { RowMenu } from "../../controls/row-menu.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { SourceAssignment } from "../../http/contracts/programming.js";
import { useMutation } from "../../http/use-resource.js";
import { PLAYBACK_MODE_CHOICES } from "../assignments/playback-mode-choices.js";
import type { ChannelProgramming } from "../use-channel-programming.js";
import { MarathonSettingsForm } from "./marathon-settings-form.js";
import { marathonLabel, perSittingLabel } from "./show-labels.js";
import { ShowPropertiesDialog } from "./show-properties-dialog.js";
import { useShowNames } from "./use-show-names.js";

/**
 * The Lineup tab: the channel's shows, its programming source assignments,
 * as a read-only list in saved order. A selected show opens in
 * **Properties** or is removed after a confirmation; shows keep the order
 * they were added, so there are no reorder controls. Every accepted write
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
  const listed = assignments.data ?? [];
  const showName = useShowNames(listed, collections.data, visible);
  const removal = useMutation();
  const [selectedId, setSelectedId] = useState<string>();
  // The show open in Properties, or `new` while adding one.
  const [editing, setEditing] = useState<string>();
  const [removing, setRemoving] = useState<SourceAssignment>();
  const selected = listed.find((assignment) => assignment.id === selectedId);
  const edited = listed.find((assignment) => assignment.id === editing);
  return (
    <section aria-label="Lineup">
      <RequestFeedback
        loading={assignments.loading || collections.loading}
        error={assignments.error ?? collections.error}
      />
      {assignments.data?.length === 0 && (
        <p className="empty-state">
          No shows yet. Add a show to begin broadcasting.
        </p>
      )}
      {listed.length > 0 && (
        <div className="table-scroll">
          <table aria-label="Shows">
            <thead>
              <tr>
                <th>Show</th>
                <th>Order</th>
                <th>Per sitting</th>
                <th>Marathons</th>
                <th aria-label="Rotation" />
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {listed.map((assignment) => (
                <tr
                  key={assignment.id}
                  className={`clickable-row${assignment.id === selectedId ? " selected-row" : ""}`}
                  {...rowClickProps(() => setSelectedId(assignment.id))}
                  onDoubleClick={(event) => {
                    if (inRowMenu(event.target)) return;
                    setSelectedId(assignment.id);
                    setEditing(assignment.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || inRowMenu(event.target)) {
                      return;
                    }
                    event.preventDefault();
                    setSelectedId(assignment.id);
                    setEditing(assignment.id);
                  }}
                >
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setSelectedId(assignment.id)}
                    >
                      {showName(assignment)}
                    </button>
                  </td>
                  <td>{orderLabel(assignment)}</td>
                  <td>{perSittingLabel(assignment.ordinaryStretch)}</td>
                  <td>{marathonLabel(assignment.marathonStretch)}</td>
                  <td>
                    {assignment.participation === "rule_only" && (
                      <span className="row-badge">Rules only</span>
                    )}
                  </td>
                  <td>
                    <RowMenu
                      label={`Actions for ${showName(assignment)}`}
                      items={[
                        {
                          label: "Properties",
                          onSelect: () => setEditing(assignment.id),
                        },
                        {
                          label: "Remove…",
                          onSelect: () => setRemoving(assignment),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {assignments.data && (
        <div className="row-actions">
          <button type="button" onClick={() => setEditing("new")}>
            New show…
          </button>
          <button
            type="button"
            disabled={selected === undefined}
            onClick={() => setEditing(selected?.id)}
          >
            Properties
          </button>
          <button
            type="button"
            disabled={selected === undefined}
            onClick={() => setRemoving(selected)}
          >
            Remove…
          </button>
        </div>
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
      {(editing === "new" || edited) && (
        <ShowPropertiesDialog
          key={editing}
          assignmentsPath={assignmentsPath}
          assignment={edited}
          title={edited ? showName(edited) : "New show"}
          collections={collections.data}
          visible={visible}
          changed={changed}
          onClose={() => setEditing(undefined)}
        />
      )}
      {removing && (
        <WindowDialog
          title="Remove show"
          busy={removal.pending}
          onClose={() => setRemoving(undefined)}
        >
          <p>
            Remove <strong>{showName(removing)}</strong> from this lineup?
            Whatever is airing now finishes; the show gets no new turns.
          </p>
          <RequestFeedback loading={removal.pending} error={removal.error} />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={removal.pending}
              onClick={() => {
                void removal.run(
                  `${assignmentsPath}/${encodeURIComponent(removing.id)}`,
                  "DELETE",
                  undefined,
                  () => {
                    setRemoving(undefined);
                    changed();
                  },
                );
              }}
            >
              Remove
            </button>
            <button
              type="button"
              disabled={removal.pending}
              onClick={() => setRemoving(undefined)}
            >
              Cancel
            </button>
          </div>
        </WindowDialog>
      )}
    </section>
  );
}

// The row menu's own clicks and keys keep their meaning inside the row.
function inRowMenu(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".row-menu") !== null;
}

// Names how a show orders its collections; single items alone have no order.
function orderLabel(assignment: SourceAssignment): string {
  const mode = assignment.playbackMode;
  if (mode === null) return "—";
  return (
    PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode
  );
}

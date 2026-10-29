import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { rowClickProps, rowOpenProps } from "../../controls/row-click.js";
import { RowMenu } from "../../controls/row-menu.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { ProgramId } from "../../desktop/contracts.js";
import type {
  MarathonSettings,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/resources/use-resource.js";
import { memberKey } from "../../media-search/collection-or-item-search.js";
import { PLAYBACK_MODE_CHOICES } from "../assignments/playback-mode-choices.js";
import type { ChannelProgramming } from "../use-channel-programming.js";
import { RebuildDialog } from "../preview/rebuild-dialog.js";
import { AddShowsDialog } from "./add-shows-dialog.js";
import { MarathonsControl } from "./marathons-control.js";
import {
  marathonLabel,
  perSittingLabel,
} from "../assignments/stretch-words.js";
import { ShowPropertiesDialog } from "./show-properties-dialog.js";
import { assignmentShowLabel } from "./show-labels.js";
import { useMemberNames } from "./use-member-names.js";

/**
 * The Lineup tab: the channel's shows, its programming source assignments,
 * as a read-only list in saved order, badging a wheel (a show of several
 * members that share its turns). **Add shows…** adds several at once, from
 * the empty state until the first show exists; a selected show opens in
 * **Properties** or is removed after a confirmation; shows keep the order
 * they were added, so there are no reorder controls. Every accepted write
 * calls `changed`. A write that changes what airs has already regenerated
 * after the airing program, so the lineup then asks what should happen to
 * that program, as the Rules tab does, once the dialog that made it closes;
 * while nothing or filler airs the write applies silently.
 */
export function LineupTab({
  channelId,
  programming,
  visible,
  onDirtyChange,
  openProgram,
}: {
  channelId: string;
  programming: ChannelProgramming;
  visible: boolean;
  /** Reports whether an open show holds unsaved edits, so closing the window asks first. */
  onDirtyChange: (dirty: boolean) => void;
  /** Opens another program, which the show picker needs for Media Library. */
  openProgram: (id: ProgramId) => void;
}) {
  const { assignments, collections, assignmentsPath, changed } = programming;
  const listed = assignments.data ?? [];
  const memberName = useMemberNames(
    listed.flatMap((assignment) => assignment.members),
    collections.data,
    visible,
  );
  // Names a show as the lineup and its dialogs show it.
  const showName = (assignment: SourceAssignment) =>
    assignmentShowLabel(assignment, memberName);
  const settingsPath = `${programming.channelPath}/programming-settings`;
  const marathons = useResource<MarathonSettings>(settingsPath, visible);
  const marathonsOff = marathons.data?.marathonChancePercent === 0;
  const removal = useMutation();
  const [selectedId, setSelectedId] = useState<string>();
  // The show open in Properties.
  const [editing, setEditing] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SourceAssignment>();
  // The airing program the rebuild question is open about; none while
  // nothing or filler airs, so such a write never asks.
  const [rebuilding, setRebuilding] = useState<string>();
  // Refreshes after a write that changed what airs, and asks about the airing program.
  const applied = () => {
    changed();
    setRebuilding(programming.airingProgram);
  };
  const selected = listed.find((assignment) => assignment.id === selectedId);
  const edited = listed.find((assignment) => assignment.id === editing);
  // Members the lineup plays outside `except`, which no other show may add.
  // Member keys of every show but `except`, since a member plays in one
  // show at a time.
  const playedElsewhere = (except: string | undefined) =>
    listed
      .filter((assignment) => assignment.id !== except)
      .flatMap((assignment) => assignment.members)
      .map(memberKey);
  return (
    <section aria-label="Lineup">
      <RequestFeedback
        loading={assignments.loading || collections.loading}
        error={assignments.error ?? collections.error}
      />
      {assignments.data?.length === 0 && (
        <p className="empty-state">
          No shows yet. Add shows to begin broadcasting.{" "}
          <button type="button" onClick={() => setAdding(true)}>
            Add shows…
          </button>
        </p>
      )}
      {listed.length > 0 && (
        <div className="table-scroll">
          <table aria-label="Shows">
            <thead>
              <tr>
                <th>Show</th>
                <th>Play order</th>
                <th>At a time</th>
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
                  {...rowOpenProps(() => {
                    setSelectedId(assignment.id);
                    setEditing(assignment.id);
                  })}
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
                  <td>
                    {perSittingLabel(
                      assignment.ordinaryStretch,
                      programming.contentKind(assignment),
                    )}
                  </td>
                  <td>
                    {marathonLabel(
                      assignment.marathonStretch,
                      programming.contentKind(assignment),
                    )}
                    {marathonsOff && assignment.marathonStretch !== null
                      ? " (off)"
                      : ""}
                  </td>
                  <td>
                    {assignment.members.length > 1 && (
                      <span className="row-badge">Wheel</span>
                    )}
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
      {/* The empty state carries Add shows…, so the bar waits for the first show. */}
      {listed.length > 0 && (
        <div className="row-actions">
          <button type="button" onClick={() => setAdding(true)}>
            Add shows…
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
        <MarathonsControl
          path={settingsPath}
          marathons={marathons}
          canMarathon={listed.some(
            (assignment) => assignment.marathonStretch !== null,
          )}
          changed={applied}
        />
      )}
      {adding && (
        <AddShowsDialog
          assignmentsPath={assignmentsPath}
          collections={collections.data}
          inLineup={new Set(playedElsewhere(undefined))}
          visible={visible}
          changed={applied}
          onClose={() => setAdding(false)}
          openProgram={openProgram}
        />
      )}
      {edited && (
        <ShowPropertiesDialog
          key={edited.id}
          assignmentsPath={assignmentsPath}
          assignment={edited}
          onDirtyChange={onDirtyChange}
          title={showName(edited)}
          collections={collections.data}
          memberName={memberName}
          unavailable={
            new Map(
              playedElsewhere(edited.id).map((key) => [key, "in another show"]),
            )
          }
          settingsPath={settingsPath}
          marathons={marathons}
          visible={visible}
          changed={changed}
          onClose={(programmingChanged) => {
            setEditing(undefined);
            if (programmingChanged) setRebuilding(programming.airingProgram);
          }}
          openProgram={openProgram}
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
                    applied();
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
      {rebuilding !== undefined && (
        <RebuildDialog
          channelId={channelId}
          rebuilt={changed}
          onClose={() => setRebuilding(undefined)}
          appliedAfter={rebuilding}
        />
      )}
    </section>
  );
}

// Names how a show orders its collections; single items alone have no order.
function orderLabel(assignment: SourceAssignment): string {
  const mode = assignment.playbackMode;
  if (mode === null) return "—";
  return (
    PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode
  );
}

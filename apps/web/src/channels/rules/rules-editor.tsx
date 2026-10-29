import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { rowClickProps, rowOpenProps } from "../../controls/row-click.js";
import { RowMenu } from "../../controls/row-menu.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type {
  ProgrammingRule,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/resources/use-resource.js";
import { listNames, showLabel } from "../lineup/show-labels.js";
import { useMemberNames } from "../lineup/use-member-names.js";
import { RebuildDialog } from "../preview/rebuild-dialog.js";
import type { ChannelProgramming } from "../use-channel-programming.js";
import type { RuleSourceChoice } from "./rule-draft.js";
import { RuleDialog } from "./rule-dialog.js";
import { behaviorWords, describeWhen } from "./rule-words.js";

/**
 * The Rules tab: the channel's programming rules as a list by priority,
 * highest first, saying in words when each applies and what it plays.
 * **New rule…** and **Properties** open the rule dialog, and **Delete…**
 * asks first. Rules that overlap at one priority play together, and saved
 * order decides whose settings a show they share uses, so a rule moves up
 * or down only among rules of its priority. Each accepted edit has already
 * regenerated after the airing program; while one airs, the question that
 * follows can also stop it and rebuild from now, and while nothing or
 * filler airs the edit applies silently.
 */
export function RulesEditor({
  channelId,
  visible,
  programming,
  onDirtyChange,
}: {
  channelId: string;
  visible: boolean;
  programming: ChannelProgramming;
  /** Reports whether the open rule dialog holds unsaved edits. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { rules, collections, contentKind, changed } = programming;
  const assignments = programming.assignments.data ?? [];
  const path = `${resourcePath("channels", channelId)}/programming-rules`;
  const timezone = useResource<{ programmingTimezone: string }>(
    "/programming-timezone",
    visible,
  );
  const mutation = useMutation();
  const memberName = useMemberNames(
    assignments.flatMap((assignment) => assignment.members),
    collections.data,
    visible,
  );
  const [selectedId, setSelectedId] = useState<string>();
  // The rule open in its dialog, `new` for a new one, or nothing.
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<ProgrammingRule>();
  // The airing program the rebuild question is open about; none while
  // nothing or filler airs, so such an edit never asks.
  const [rebuilding, setRebuilding] = useState<string>();
  // Closes any dialog, refreshes what the edit changed, and asks about the airing program.
  const saved = () => {
    setEditing(undefined);
    setDeleting(undefined);
    changed();
    setRebuilding(programming.airingProgram);
  };
  const savedOrder = rules.data ?? [];
  // Highest priority first, then saved order, as the server ranks them.
  const ranked = [...savedOrder].sort((a, b) => b.priority - a.priority);
  const selected = ranked.find((rule) => rule.id === selectedId);
  const edited = ranked.find((rule) => rule.id === editing);
  // Names a show as the Lineup tab does.
  const showName = (assignment: SourceAssignment) =>
    showLabel(assignment.name, assignment.members.map(memberName));
  const choices: RuleSourceChoice[] = assignments.map((assignment) => ({
    assignmentId: assignment.id,
    label: showName(assignment),
    ruleOnly: assignment.participation === "rule_only",
    contentKind: contentKind(assignment),
    ordinaryStretch: assignment.ordinaryStretch,
  }));
  // Names a rule's shows, two at most, counting the rest.
  const showsOf = (rule: ProgrammingRule) => {
    const names = rule.sources.map(
      (source) =>
        choices.find((choice) => choice.assignmentId === source.assignmentId)
          ?.label ?? "Removed from the lineup",
    );
    return listNames(names);
  };
  // Trades a rule's place in saved order with its equal-priority neighbor.
  const move = (rule: ProgrammingRule, neighbor: ProgrammingRule) => {
    const ids = savedOrder.map(({ id }) => id);
    const from = ids.indexOf(rule.id);
    const to = ids.indexOf(neighbor.id);
    ids[from] = neighbor.id;
    ids[to] = rule.id;
    void mutation.run(`${path}/order`, "PUT", { ruleIds: ids }, saved);
  };
  // Opens a rule's properties, selecting it as a double-click or Enter does.
  const open = (rule: ProgrammingRule) => {
    setSelectedId(rule.id);
    setEditing(rule.id);
  };
  return (
    <section aria-label="Programming rules">
      <p className="secondary">
        Rules change what the channel plays on certain dates, days, or hours.
        Overlapping rules with the same priority play together; a higher
        priority takes over.
      </p>
      <RequestFeedback
        loading={rules.loading || mutation.pending}
        error={mutation.error ?? rules.error ?? timezone.error}
      />
      {rules.data?.length === 0 && (
        <p className="empty-state">
          No rules. The lineup plays in rotation at all times.
        </p>
      )}
      {ranked.length > 0 && (
        <div className="table-scroll">
          <table aria-label="Rules by priority">
            <thead>
              <tr>
                <th>Rule</th>
                <th>When</th>
                <th>Plays</th>
                {/* The rule dialog's own words for the behavior choice. */}
                <th>While it applies</th>
                <th>Priority</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {ranked.map((rule, index) => {
                const above = ranked[index - 1];
                const below = ranked[index + 1];
                return (
                  <tr
                    key={rule.id}
                    className={`clickable-row${rule.id === selectedId ? " selected-row" : ""}`}
                    {...rowClickProps(() => setSelectedId(rule.id))}
                    {...rowOpenProps(() => open(rule))}
                  >
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedId(rule.id)}
                      >
                        {rule.name}
                      </button>
                    </td>
                    <td>{describeWhen(rule)}</td>
                    <td>{showsOf(rule)}</td>
                    <td>{behaviorWords(rule.behavior)}</td>
                    <td>{rule.priority}</td>
                    <td>
                      <RowMenu
                        label={`Actions for ${rule.name}`}
                        items={[
                          { label: "Properties", onSelect: () => open(rule) },
                          {
                            label: "Move up",
                            disabled:
                              mutation.pending ||
                              above?.priority !== rule.priority,
                            onSelect: () => above && move(rule, above),
                          },
                          {
                            label: "Move down",
                            disabled:
                              mutation.pending ||
                              below?.priority !== rule.priority,
                            onSelect: () => below && move(rule, below),
                          },
                          {
                            label: "Delete…",
                            onSelect: () => setDeleting(rule),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rules.data && (
        <div className="row-actions">
          <button type="button" onClick={() => setEditing("new")}>
            New rule…
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
            onClick={() => setDeleting(selected)}
          >
            Delete…
          </button>
        </div>
      )}
      {(editing === "new" || edited) && (
        <RuleDialog
          key={editing}
          path={edited ? `${path}/${encodeURIComponent(edited.id)}` : path}
          rule={edited}
          choices={choices}
          timezone={timezone.data?.programmingTimezone}
          saved={saved}
          onDirtyChange={onDirtyChange}
          onClose={() => setEditing(undefined)}
        />
      )}
      {deleting && (
        <WindowDialog
          title="Delete rule"
          busy={mutation.pending}
          onClose={() => setDeleting(undefined)}
        >
          <p>
            Delete <strong>{deleting.name}</strong>? Nothing is removed from the
            lineup.
          </p>
          <RequestFeedback loading={mutation.pending} error={mutation.error} />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={mutation.pending}
              onClick={() =>
                void mutation.run(
                  `${path}/${encodeURIComponent(deleting.id)}`,
                  "DELETE",
                  undefined,
                  saved,
                )
              }
            >
              Delete
            </button>
            <button
              type="button"
              disabled={mutation.pending}
              onClick={() => setDeleting(undefined)}
            >
              Cancel
            </button>
          </div>
        </WindowDialog>
      )}
      {rebuilding !== undefined && (
        <RebuildDialog
          channelId={channelId}
          appliedAfter={rebuilding}
          rebuilt={changed}
          onClose={() => setRebuilding(undefined)}
        />
      )}
    </section>
  );
}

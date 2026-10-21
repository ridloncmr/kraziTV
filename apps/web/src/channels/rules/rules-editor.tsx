import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { rowClickProps } from "../../controls/row-click.js";
import { inRowMenu, RowMenu } from "../../controls/row-menu.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type {
  ProgrammingRule,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/use-resource.js";
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
 * asks first. Saved order only breaks priority ties, so a rule moves up or
 * down only among rules of its priority. Each accepted edit has already
 * regenerated after the airing program; the rebuild choice that follows
 * can also stop it and rebuild from now.
 */
export function RulesEditor({
  channelId,
  visible,
  programming,
}: {
  channelId: string;
  visible: boolean;
  programming: ChannelProgramming;
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
  const [rebuilding, setRebuilding] = useState(false);
  // Closes any dialog, refreshes what the edit changed, and offers the rebuild choice.
  const saved = () => {
    setEditing(undefined);
    setDeleting(undefined);
    changed();
    setRebuilding(true);
  };
  const savedOrder = rules.data ?? [];
  // Highest priority first; saved order breaks ties, as the server ranks them.
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
          ?.label ?? "A removed show",
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
        Rules change what plays on certain dates, days, or hours. When rules
        overlap, the higher priority wins.
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
                <th>Shows</th>
                <th>Plays</th>
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
                    onDoubleClick={(event) => {
                      if (!inRowMenu(event.target)) open(rule);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || inRowMenu(event.target)) {
                        return;
                      }
                      event.preventDefault();
                      open(rule);
                    }}
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
            Delete <strong>{deleting.name}</strong>? Its shows stay in the
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
      {rebuilding && (
        <RebuildDialog
          channelId={channelId}
          finishApplied
          rebuilt={changed}
          onClose={() => setRebuilding(false)}
        />
      )}
    </section>
  );
}

import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { resourcePath } from "../../http/api-client.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  ProgrammingRule,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import type { ContentKind } from "../contracts.js";
import { RebuildDialog } from "../preview/rebuild-dialog.js";
import {
  RuleForm,
  type RuleSourceChoice,
  toClock,
  WEEKDAYS,
} from "./rule-form.js";

/**
 * Lists the channel's programming rules by priority, highest first, and
 * lets the owner add, edit, delete, and reorder them. Saved order only
 * breaks priority ties, so a rule moves only among rules of its priority.
 * Each accepted edit has already regenerated after the airing program; the
 * rebuild choice that follows can also stop it and rebuild from now.
 */
export function RulesEditor({
  channelId,
  visible,
  rules,
  assignments,
  collections,
  contentKind,
  changed,
}: {
  channelId: string;
  visible: boolean;
  rules: ReturnType<typeof useResource<ProgrammingRule[]>>;
  assignments: readonly SourceAssignment[];
  collections: MediaCollection[] | undefined;
  /** Words each source's per-sitting presets for what it plays. */
  contentKind: (assignment: SourceAssignment) => ContentKind;
  changed: () => void;
}) {
  const path = `${resourcePath("channels", channelId)}/programming-rules`;
  const timezone = useResource<{ programmingTimezone: string }>(
    "/programming-timezone",
    visible,
  );
  const mutation = useMutation();
  // The rule being edited, `new` for the add form, or nothing.
  const [editing, setEditing] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  // Closes the form, refreshes what the edit changed, and offers the rebuild choice.
  const saved = () => {
    setEditing(null);
    changed();
    setRebuilding(true);
  };
  const savedOrder = rules.data ?? [];
  // Highest priority first; saved order breaks ties, as the server ranks them.
  const ranked = [...savedOrder].sort((a, b) => b.priority - a.priority);
  const choices: RuleSourceChoice[] = assignments.map((assignment, index) => ({
    assignmentId: assignment.id,
    label: assignmentLabel(assignment, index, collections),
    contentKind: contentKind(assignment),
    ordinaryStretch: assignment.ordinaryStretch,
  }));
  // Trades a rule's place in saved order with its equal-priority neighbor.
  const move = (rule: ProgrammingRule, neighbor: ProgrammingRule) => {
    const ids = savedOrder.map(({ id }) => id);
    const from = ids.indexOf(rule.id);
    const to = ids.indexOf(neighbor.id);
    ids[from] = neighbor.id;
    ids[to] = rule.id;
    void mutation.run(`${path}/order`, "PUT", { ruleIds: ids }, saved);
  };
  return (
    <section aria-label="Programming rules">
      <h4>Programming rules</h4>
      {timezone.data && (
        <p className="secondary">
          Rules follow the server's programming timezone,{" "}
          {timezone.data.programmingTimezone}, not this browser's.
        </p>
      )}
      <RequestFeedback
        loading={rules.loading || mutation.pending}
        error={mutation.error ?? rules.error ?? timezone.error}
      />
      <ol aria-label="Rules by priority">
        {ranked.map((rule, index) => {
          const above = ranked[index - 1];
          const below = ranked[index + 1];
          return (
            <li key={rule.id}>
              {editing === rule.id ? (
                <RuleForm
                  path={`${path}/${encodeURIComponent(rule.id)}`}
                  rule={rule}
                  legend={`Edit ${rule.name}`}
                  choices={choices}
                  saved={saved}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <h5>{rule.name}</h5>
                  <p className="secondary">{describeRule(rule)}</p>
                  <div className="row-actions">
                    <button
                      type="button"
                      disabled={mutation.pending}
                      onClick={() => setEditing(rule.id)}
                    >
                      Edit rule
                    </button>
                    <button
                      type="button"
                      disabled={mutation.pending}
                      onClick={() => {
                        void mutation.run(
                          `${path}/${encodeURIComponent(rule.id)}`,
                          "DELETE",
                          undefined,
                          saved,
                        );
                      }}
                    >
                      Delete rule
                    </button>
                    {above?.priority === rule.priority && (
                      <button
                        type="button"
                        disabled={mutation.pending}
                        onClick={() => move(rule, above)}
                      >
                        Move up
                      </button>
                    )}
                    {below?.priority === rule.priority && (
                      <button
                        type="button"
                        disabled={mutation.pending}
                        onClick={() => move(rule, below)}
                      >
                        Move down
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {editing === "new" ? (
        <RuleForm
          path={path}
          legend="New rule"
          choices={choices}
          saved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" onClick={() => setEditing("new")}>
          Add a rule
        </button>
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

/**
 * Names an assignment by the owner's name for it, else by its members'
 * collections, as the owner knows them.
 */
function assignmentLabel(
  assignment: SourceAssignment,
  index: number,
  collections: MediaCollection[] | undefined,
): string {
  if (assignment.name !== null) return assignment.name;
  const names = assignment.members.flatMap((member) =>
    member.kind === "collection"
      ? [
          collections?.find(({ id }) => id === member.mediaCollectionId)
            ?.name ?? "A collection",
        ]
      : [],
  );
  return names.length > 0 ? names.join(", ") : `Assignment ${index + 1}`;
}

/** Summarizes a rule's behavior, priority, and calendar conditions in a line. */
function describeRule(rule: ProgrammingRule): string {
  const { dates, weekdays, window } = rule;
  return [
    rule.behavior === "join" ? "Joins normal rotation" : "Features its sources",
    `priority ${rule.priority}`,
    dates.kind === "one_off"
      ? `${dates.startDate} through ${dates.endDate}`
      : dates.kind === "annual"
        ? `every year ${dates.startMonthDay} through ${dates.endMonthDay}`
        : "any date",
    weekdays === null
      ? "every day"
      : weekdays.map((day) => WEEKDAYS[day]).join(", "),
    window === null
      ? "all day"
      : `${toClock(window.startMinute)}–${toClock(window.endMinute)}`,
    `${rule.sources.length} source${rule.sources.length === 1 ? "" : "s"}`,
  ].join(" · ");
}

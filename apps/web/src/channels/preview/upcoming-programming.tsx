import { displayListTime } from "../../controls/display-time.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  PreviewTurn,
  ProgrammingPreview,
  ProgrammingRule,
} from "../../http/contracts/programming.js";
import { useResource } from "../../http/resources/use-resource.js";

// Names why kraziPlan passed over an assignment's member.
const SKIP_REASONS: Record<string, string> = {
  empty_collection: "its collection is empty",
  no_schedulable_members: "nothing in its collection can air",
  media_item_unschedulable: "its item cannot air",
};

// Names why kraziPlan passed over an applicable rule.
const RULE_SKIP_REASONS: Record<string, string> = {
  no_sources: "it selects no sources",
  no_usable_source: "none of its sources can air",
};

/**
 * Shows the server's preview of the channel's next turns, as a
 * regeneration from now would air them: each turn's source, size, overrun,
 * and marathon, the rule that chose it and the rules passed over before
 * it, where its settings came from, and the assignments its rounds skip,
 * with why. It never decides anything itself and writes nothing.
 */
export function UpcomingProgramming({
  path,
  visible,
  collections,
  rules,
}: {
  path: string;
  visible: boolean;
  collections: MediaCollection[] | undefined;
  rules: ProgrammingRule[] | undefined;
}) {
  const preview = useResource<ProgrammingPreview>(path, visible);
  // Names a turn's member as the owner knows it.
  const memberName = ({ member, programs }: PreviewTurn) =>
    member?.kind === "collection"
      ? (collections?.find(
          (collection) => collection.id === member.mediaCollectionId,
        )?.name ?? "A collection")
      : (programs[0]?.title ?? "A single item");
  // Names a rule as the owner knows it.
  const ruleName = (id: string) =>
    rules?.find((rule) => rule.id === id)?.name ?? "a rule";
  return (
    <section aria-label="Upcoming programming">
      <h4>Upcoming programming</h4>
      {rules !== undefined && rules.length > 0 && (
        <p className="secondary">
          Rule windows are preferences checked at program boundaries: a program
          already airing finishes, so the preview never promises a program
          starts exactly when a window opens.
        </p>
      )}
      <RequestFeedback loading={preview.loading} error={preview.error} />
      {preview.data && (
        <>
          <ol aria-label="Upcoming turns">
            {preview.data.turns.map((turn, index, turns) => (
              <li
                key={`${turn.roundNumber}:${turn.turnIndex}:${turn.startsAt}`}
              >
                {turn.startsAt === null
                  ? ""
                  : `${displayListTime(turn.startsAt, turns[index - 1]?.startsAt ?? undefined)} · `}
                {memberName(turn)} · {describeTurn(turn)} ·{" "}
                {describeDecision(turn, ruleName)}
              </li>
            ))}
          </ol>
          {preview.data.skips.length > 0 && (
            <ul aria-label="Skipped assignments">
              {preview.data.skips.map((skip) => (
                <li key={`${skip.roundNumber}:${skip.assignmentId}`}>
                  Round {skip.roundNumber} skips an assignment:{" "}
                  {skip.reasons
                    .map((reason) => SKIP_REASONS[reason] ?? reason)
                    .join("; ")}
                  .
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Explains why a turn's source could air and where its sizes came from:
 * the winning rule or normal rotation, each rule passed over first with
 * why, and any setting the rule replaced or turned off.
 */
function describeDecision(
  turn: PreviewTurn,
  ruleName: (id: string) => string,
): string {
  const parts = [
    turn.winningRuleId === null
      ? "normal rotation"
      : `chosen by ${ruleName(turn.winningRuleId)}`,
  ];
  for (const skip of turn.skippedRules ?? []) {
    parts.push(
      `passed over ${ruleName(skip.ruleId)}: ${RULE_SKIP_REASONS[skip.reason] ?? skip.reason}`,
    );
  }
  if (turn.settingOrigins.ordinary === "rule") {
    parts.push("the rule's turn length");
  }
  if (turn.marathon && turn.settingOrigins.marathon === "rule") {
    parts.push("the rule's marathon length");
  } else if (turn.settingOrigins.marathon === "disabled") {
    parts.push("marathons off under the rule");
  }
  return parts.join(" · ");
}

/** Explains a turn's length, overrun, and any marathon in a line. */
function describeTurn(turn: PreviewTurn): string {
  const parts = [
    `${turn.programs.length} program${turn.programs.length === 1 ? "" : "s"}, ${Math.round(turn.airtimeMinutes)} min`,
  ];
  if (turn.continues) parts.push("continues the turn on air");
  if (turn.overrunMinutes !== null && turn.size !== null) {
    parts.push(
      `${Math.round(turn.overrunMinutes)} min over its ${turn.size.value}-minute target, since whole programs air`,
    );
  }
  if (turn.marathon) {
    parts.push(
      `marathon, from this round's ${turn.marathonChancePercent ?? 0}% chance`,
    );
  }
  return parts.join(" · ");
}

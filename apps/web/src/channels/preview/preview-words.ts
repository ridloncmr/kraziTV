import type { PreviewTurn } from "../../http/contracts/programming.js";
import { countWords, minutesWords } from "../stretch/stretch-words.js";
import type { ContentKind } from "../contracts.js";

// Words for the Preview tab's lines, which answer "did my channel work?"
// in the owner's vocabulary: shows, episodes, movies, and rules. Rounds,
// chances, cooldowns, and assignments never reach a line.

// Names why kraziPlan passed over a show.
const SKIP_REASONS: Record<string, string> = {
  empty_collection: "its collection is empty",
  no_schedulable_members: "nothing in its collection can air",
  media_item_unschedulable: "its item cannot air",
};

// Names why kraziPlan passed over an applicable rule.
const RULE_SKIP_REASONS: Record<string, string> = {
  no_sources: "it names no shows",
  no_usable_source: "none of its shows can air",
};

/** What a turn's line needs beyond the turn: the names the owner knows and whether rules are in play. */
export interface TurnContext {
  /** The show taking the turn, as the owner knows it. */
  show: string;
  /** What the show plays, which words its programs as episodes or movies. */
  kind: ContentKind;
  /** Whether any rule shapes the preview, so a default turn says it is normal rotation. */
  rulesInPlay: boolean;
  ruleName: (id: string) => string;
}

/**
 * Words one upcoming turn as a listing line after its time: the show, then
 * what plays, then only what needs explaining: that it is already airing,
 * an overrun past its target, the rule that chose it or normal rotation
 * while a rule is in play, the rules passed over, and the settings a rule
 * set. A marathon says so with its stretch and never its chance.
 */
export function turnWords(turn: PreviewTurn, context: TurnContext): string {
  const plays = `${countWords(turn.programs.length, context.kind)} (${minutesWords(Math.round(turn.airtimeMinutes))})`;
  const parts = [context.show, turn.marathon ? `marathon, ${plays}` : plays];
  if (turn.continues) parts.push("already airing");
  if (turn.overrunMinutes !== null && turn.size !== null) {
    parts.push(
      `${Math.round(turn.overrunMinutes)} min over its ${minutesWords(turn.size.value)} target, since whole programs air`,
    );
  }
  if (turn.winningRuleId !== null) {
    parts.push(`chosen by ${context.ruleName(turn.winningRuleId)}`);
  } else if (context.rulesInPlay) {
    parts.push("normal rotation");
  }
  for (const skip of turn.skippedRules ?? []) {
    parts.push(
      `passed over ${context.ruleName(skip.ruleId)}: ${RULE_SKIP_REASONS[skip.reason] ?? skip.reason}`,
    );
  }
  if (turn.settingOrigins.ordinary === "rule") {
    parts.push("length set by the rule");
  }
  if (turn.marathon && turn.settingOrigins.marathon === "rule") {
    parts.push("marathon length set by the rule");
  } else if (turn.settingOrigins.marathon === "disabled") {
    parts.push("no marathons under the rule");
  }
  return parts.join(" · ");
}

/** Whether any previewed turn was chosen by a rule or passed one over, so "normal rotation" has something to contrast with. */
export function rulesInPlay(turns: readonly PreviewTurn[]): boolean {
  return turns.some(
    (turn) =>
      turn.winningRuleId !== null || (turn.skippedRules?.length ?? 0) > 0,
  );
}

/** Words a show kraziPlan skipped with every reason, keeping a reason code this browser does not know yet. */
export function skipWords(show: string, reasons: readonly string[]): string {
  return `${show} is skipped: ${reasons
    .map((reason) => SKIP_REASONS[reason] ?? reason)
    .join("; ")}.`;
}

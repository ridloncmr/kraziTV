import { rulesInPlay, skipWords, turnWords } from "./preview-words.js";
import { displayListTime } from "../../controls/formatting/display-time.js";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import type {
  PreviewTurn,
  ProgrammingPreview,
} from "../../http/contracts/programming.js";
import { useResource } from "../../http/resources/use-resource.js";
import { assignmentShowLabel } from "../lineup/show-labels.js";
import { useMemberNames } from "../lineup/use-member-names.js";
import type { ChannelProgramming } from "../use-channel-programming.js";

/**
 * Shows the server's preview of the channel's next turns, as a
 * regeneration from now would air them, as a listing: each turn's time,
 * show, and what plays, with the rule that chose it and anything else
 * that needs explaining, then the shows passed over and why. It never
 * decides anything itself and writes nothing.
 */
export function UpcomingProgramming({
  programming,
  visible,
}: {
  programming: ChannelProgramming;
  visible: boolean;
}) {
  const preview = useResource<ProgrammingPreview>(
    `${programming.channelPath}/programming-preview`,
    visible,
  );
  const assignments = programming.assignments.data ?? [];
  const collections = programming.collections.data;
  const rules = programming.rules.data;
  const memberName = useMemberNames(
    assignments.flatMap((assignment) => assignment.members),
    collections,
    visible,
  );
  const assignmentOf = (id: string | null) =>
    assignments.find((assignment) => assignment.id === id);
  // Names a turn's show as the owner knows it: the owner's name for the
  // show, else the member playing, since a wheel's turn plays one member.
  // A single item is named by its program, which the preview carries.
  const turnShow = ({ assignmentId, member, programs }: PreviewTurn) =>
    assignmentOf(assignmentId)?.name ??
    (member?.kind === "collection"
      ? memberName(member)
      : (programs[0]?.title ?? "A single item"));
  // What a turn's show plays, which words its programs; unknown once the
  // show has left the lineup, as a continued turn's may have.
  const turnKind = (turn: PreviewTurn) => {
    const assignment = assignmentOf(turn.assignmentId);
    return assignment ? programming.contentKind(assignment) : null;
  };
  // Names a rule as the owner knows it.
  const ruleName = (id: string) =>
    rules?.find((rule) => rule.id === id)?.name ?? "a rule";
  const inPlay = preview.data ? rulesInPlay(preview.data.turns) : false;
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
          <ol aria-label="Upcoming shows">
            {preview.data.turns.map((turn, index, turns) => (
              <li
                key={`${turn.roundNumber}:${turn.turnIndex}:${turn.startsAt}`}
              >
                {turn.startsAt === null
                  ? ""
                  : `${displayListTime(turn.startsAt, turns[index - 1]?.startsAt ?? undefined)} · `}
                {turnWords(turn, {
                  show: turnShow(turn),
                  kind: turnKind(turn),
                  rulesInPlay: inPlay,
                  ruleName,
                })}
              </li>
            ))}
          </ol>
          {preview.data.skips.length > 0 && (
            <ul aria-label="Skipped shows">
              {preview.data.skips.map((skip) => {
                const assignment = assignmentOf(skip.assignmentId);
                return (
                  <li key={`${skip.roundNumber}:${skip.assignmentId}`}>
                    {skipWords(
                      assignment
                        ? assignmentShowLabel(assignment, memberName)
                        : "A show",
                      skip.reasons,
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

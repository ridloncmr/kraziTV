import { displayTime } from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import type {
  MediaCollection,
  PreviewTurn,
  ProgrammingPreview,
} from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";

// Names why kraziPlan passed over an assignment's member.
const SKIP_REASONS: Record<string, string> = {
  empty_collection: "its collection is empty",
  no_schedulable_members: "nothing in its collection can air",
  media_item_unschedulable: "its item cannot air",
};

/**
 * Shows the server's preview of the channel's next turns, as a
 * regeneration from now would air them: each turn's source, size, overrun,
 * and marathon, and the assignments its rounds skip, with why. It never
 * decides anything itself and writes nothing.
 */
export function UpcomingProgramming({
  path,
  visible,
  collections,
}: {
  path: string;
  visible: boolean;
  collections: MediaCollection[] | undefined;
}) {
  const preview = useResource<ProgrammingPreview>(path, visible);
  // Names a turn's member as the owner knows it.
  const memberName = ({ member, programs }: PreviewTurn) =>
    member?.kind === "collection"
      ? (collections?.find(
          (collection) => collection.id === member.mediaCollectionId,
        )?.name ?? "A collection")
      : (programs[0]?.title ?? "A single item");
  return (
    <section aria-label="Upcoming programming">
      <h4>Upcoming programming</h4>
      <RequestFeedback loading={preview.loading} error={preview.error} />
      {preview.data && (
        <>
          <ol aria-label="Upcoming turns">
            {preview.data.turns.map((turn) => (
              <li
                key={`${turn.roundNumber}:${turn.turnIndex}:${turn.startsAt}`}
              >
                {turn.startsAt === null
                  ? ""
                  : `${displayTime(turn.startsAt)} · `}
                {memberName(turn)} · {describeTurn(turn)}
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

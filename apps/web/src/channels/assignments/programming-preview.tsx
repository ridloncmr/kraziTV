import { displayTime } from "../../controls/display-time.js";
import type {
  CollectionPreview,
  PreviewMember,
  UpcomingSelection,
} from "../../http/contracts/programming.js";

/**
 * Renders the server's preview of an assigned collection: the order the selected mode
 * plays, with the flags the server explains, and what airs next in the
 * saved mode. It never orders anything itself.
 */
export function ProgrammingPreview({
  preview,
}: {
  preview: CollectionPreview;
}) {
  return (
    <section aria-label="Order preview">
      {preview.ordered === null ? (
        <p>Random has no fixed order; see the upcoming selections.</p>
      ) : (
        <ol aria-label="Play order">
          {preview.ordered.map((member) => (
            <li key={member.mediaItemId}>
              {member.startsSeriesGroup && (
                <strong>{member.seriesName ?? "Series"}: </strong>
              )}
              {member.title}
              <small className="secondary"> {describeMember(member)}</small>
            </li>
          ))}
        </ol>
      )}
      {preview.upcoming === null ? (
        <p>Save this mode to see its upcoming selections.</p>
      ) : (
        <UpcomingSelections selections={preview.upcoming} />
      )}
    </section>
  );
}

/** Lists the selections a collection airs next, as the schedule holds them. */
export function UpcomingSelections({
  selections,
}: {
  selections: UpcomingSelection[];
}) {
  return selections.length === 0 ? (
    <p>No upcoming selections yet.</p>
  ) : (
    <ol aria-label="Upcoming selections">
      {selections.map((selection) => (
        <li key={selection.id}>
          {displayTime(selection.startsAt)} · {selection.title}
        </li>
      ))}
    </ol>
  );
}

// Names the facts a member's place rests on, and why it may surprise.
function describeMember(member: PreviewMember): string {
  const facts = [
    member.seasonNumber !== null && member.episodeNumber !== null
      ? `S${member.seasonNumber}E${member.episodeNumber}`
      : null,
    member.releaseDate,
    member.unresolved ? "no ordering details; plays after the rest" : null,
    member.duplicateEpisode ? "duplicate episode" : null,
  ];
  return facts.filter((fact) => fact !== null).join(" · ");
}

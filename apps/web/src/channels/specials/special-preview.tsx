import { displayTime } from "../../controls/display-time.js";
import type { SpecialPreview as Preview } from "./contracts.js";

/**
 * Shows what saving a special would air, exactly as the server previewed
 * it: its range, its programs, the filler before and inside it, the
 * ordinary program it pushes later, what resumes after it, and every
 * conflict. Beyond the horizon
 * the surrounding schedule is planned closer to the date, so it says so and
 * labels a collection's programs as estimated.
 */
export function SpecialPreview({ preview }: { preview: Preview }) {
  // Words one interval as the times the owner reads in the guide.
  const range = (interval: { startsAt: string; endsAt: string }) =>
    `${displayTime(interval.startsAt)} – ${displayTime(interval.endsAt)}`;
  if (preview.conflicts.length > 0) {
    return (
      <div role="alert" aria-label="Special conflicts">
        <p>This special cannot be saved:</p>
        <ul>
          {preview.conflicts.map((conflict) => (
            <li key={conflict.code}>{conflict.message}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <section aria-label="Special preview">
      {preview.startsAt && preview.endsAt && (
        <p>
          Airs {range({ startsAt: preview.startsAt, endsAt: preview.endsAt })}
          {preview.endKind === "program_derived"
            ? ", ending with its last program."
            : "."}
        </p>
      )}
      {preview.beyondHorizon && (
        <p className="secondary">
          The programming around this special is planned closer to the date, so
          nothing is moved for it yet.
        </p>
      )}
      <ol aria-label="Special programs">
        {(preview.programs ?? []).map((program, index) => (
          <li key={`${program.mediaItemId}-${index}`}>
            {program.title} · {range(program)}
            {program.estimated && " (estimated)"}
          </li>
        ))}
      </ol>
      {preview.programs?.length === 0 && (
        <p>No program fits; the channel shows filler for the whole range.</p>
      )}
      {preview.fillerBefore && (
        <p>Filler before it: {range(preview.fillerBefore)}.</p>
      )}
      {preview.fillerInside && (
        <p>Filler inside it: {range(preview.fillerInside)}.</p>
      )}
      {preview.deferredProgram && (
        <p>
          {preview.deferredProgram.title} airs after the special instead of
          before it.
        </p>
      )}
      {preview.resumesWith && (
        <p>
          Normal programming resumes with {preview.resumesWith.title} at{" "}
          {displayTime(preview.resumesWith.startsAt)}.
        </p>
      )}
    </section>
  );
}

import { TmdbAttribution } from "../../branding/attribution/tmdb-attribution.js";
import { displayTimeRange } from "../../controls/formatting/display-time.js";
import { WindowDialog } from "../../controls/dialogs/window-dialog.js";
import { Poster } from "../../controls/poster/poster.js";
import type { Channel, GuideProgram } from "../../http/contracts/channels.js";
import { episodeCode } from "./program-words.js";

/**
 * One program's card, opened from its guide block: the poster and facts the
 * server worded beside when and where it airs. It shows what the schedule
 * reports and offers nothing to change; programming is set in My Channels.
 * Facts come from TMDB, whose terms want its logo and notice wherever they
 * show, so a card with facts carries the attribution. While the program is
 * airing, **Watch** opens TV on its channel; the row decides when that is.
 */
export function ProgramCard({
  program,
  channel,
  startsAt,
  endsAt,
  onWatch,
  onClose,
}: {
  program: GuideProgram;
  channel: Channel;
  startsAt: string;
  endsAt: string;
  /** Present only while the program airs on an enabled channel. */
  onWatch?: () => void;
  onClose: () => void;
}) {
  return (
    <WindowDialog title={program.title} onClose={onClose}>
      <div className="media-details">
        {program.posterUrl && (
          <Poster
            className="media-poster"
            src={program.posterUrl}
            alt={`Poster for ${program.title}`}
          />
        )}
        <dl className="facts">
          {program.episode && (
            <>
              <dt>Episode</dt>
              <dd>
                {episodeCode(program.episode)}
                {program.subTitle && ` · ${program.subTitle}`}
              </dd>
            </>
          )}
          {!program.episode && program.subTitle && (
            <>
              <dt>Episode</dt>
              <dd>{program.subTitle}</dd>
            </>
          )}
          {program.kind === "movie" && program.releaseDate && (
            <>
              <dt>Released</dt>
              <dd>{program.releaseDate.slice(0, 4)}</dd>
            </>
          )}
          <dt>Airs</dt>
          <dd>
            {displayTimeRange(startsAt, endsAt)} on {channel.number}{" "}
            {channel.name}
          </dd>
          {program.genres.length > 0 && (
            <>
              <dt>Genres</dt>
              <dd>{program.genres.join(", ")}</dd>
            </>
          )}
        </dl>
      </div>
      {program.description && (
        <p className="program-description">{program.description}</p>
      )}
      {program.kind !== null && <TmdbAttribution />}
      <div className="dialog-actions">
        {onWatch && (
          <button type="button" onClick={onWatch}>
            Watch
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </WindowDialog>
  );
}

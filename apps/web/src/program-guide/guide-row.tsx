import {
  displayClockTime,
  displayTimeRange,
} from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { Channel, ScheduleWindow } from "../http/contracts/channels.js";
import { useResource } from "../http/resources/use-resource.js";
import { scheduleWindowPath } from "../schedule-view/schedule-window-path.js";
import { placeBlock } from "./guide-geometry.js";

/**
 * One channel's row of the guide: its number and name, then its programs
 * and planned filler laid along the window at the server's times. The row
 * reads its own schedule window, so rows arrive independently and a failed
 * read shows here without hiding the others.
 */
export function GuideRow({
  channel,
  windowStart,
  now,
  visible,
}: {
  channel: Channel;
  /** The instant at the window's left edge. */
  windowStart: number;
  /** The instant the now line marks; the block enclosing it is airing. */
  now: number;
  visible: boolean;
}) {
  const schedule = useResource<ScheduleWindow>(
    scheduleWindowPath(channel.id, windowStart),
    visible,
  );
  const blocks = schedule.data ? guideBlocks(schedule.data, windowStart) : [];
  return (
    <li className="guide-row">
      <div className="guide-channel">
        <strong>{channel.number}</strong> {channel.name}
        {!channel.enabled && <span className="row-badge">Disabled</span>}
      </div>
      <div className="guide-track">
        <RequestFeedback loading={schedule.loading} error={schedule.error} />
        {schedule.data && blocks.length === 0 && (
          <span className="guide-empty">Nothing scheduled</span>
        )}
        {blocks.length > 0 && (
          <ol aria-label={`Programs on ${channel.name}`}>
            {blocks.map((block) => (
              <li
                key={block.key}
                className={`guide-block${block.offAir ? " off-air" : ""}${
                  Date.parse(block.startsAt) <= now &&
                  now < Date.parse(block.endsAt)
                    ? " airing"
                    : ""
                }`}
                style={{ left: block.left, width: block.width }}
                title={`${block.title} · ${displayTimeRange(block.startsAt, block.endsAt)}`}
              >
                <strong>{block.title}</strong>{" "}
                <span>{displayClockTime(block.startsAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

/**
 * The window's programs and planned filler, as Off air, in time order, each
 * placed in the row; what ended before the window or starts after it is
 * left out.
 */
function guideBlocks(window: ScheduleWindow, windowStart: number) {
  return [
    ...window.entries.map((entry) => ({
      key: entry.id,
      title: entry.title,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      offAir: false,
    })),
    ...window.fillerIntervals.map((interval) => ({
      key: `off-air-${interval.startsAt}`,
      title: "Off air",
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      offAir: true,
    })),
  ]
    .flatMap((block) => {
      const place = placeBlock(block.startsAt, block.endsAt, windowStart);
      return place ? [{ ...block, ...place }] : [];
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

import { useEffect, useState } from "react";
import {
  displayClockTime,
  displayTimeRange,
} from "../../controls/formatting/display-time.js";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import type {
  Channel,
  GuideProgram,
  ScheduleWindow,
} from "../../http/contracts/channels.js";
import { useResource } from "../../http/resources/use-resource.js";
import { scheduleWindowPath } from "./schedule-window-path.js";
import { placeBlock } from "./guide-geometry.js";
import { ProgramCard } from "../program/program-card.js";
import { programMark } from "../program/program-words.js";

/** One block of the row: a program, or planned filler shown as Off air. */
interface GuideBlock {
  key: string;
  startsAt: string;
  endsAt: string;
  left: number;
  width: number;
  /** Null for Off air, which has no program to open. */
  program: GuideProgram | null;
}

/**
 * One channel's row of the guide: its number and name, then its programs
 * and planned filler laid along the window at the server's times. The row
 * reads its own schedule window, so rows arrive independently and a failed
 * read shows here without hiding the others. A program block opens its
 * card; Off air is only a label. An enabled channel's name opens it on TV,
 * as choosing a channel in a TV guide tunes it, and so does the card of the
 * program it is airing.
 */
export function GuideRow({
  channel,
  windowStart,
  now,
  visible,
  onWatch,
}: {
  channel: Channel;
  /** The instant at the window's left edge. */
  windowStart: number;
  /** The instant the now line marks; the block enclosing it is airing. */
  now: number;
  visible: boolean;
  onWatch: (channelId: string) => void;
}) {
  const schedule = useResource<ScheduleWindow>(
    scheduleWindowPath(channel.id, windowStart),
    visible,
  );
  const [opened, setOpened] = useState<GuideBlock>();
  const [watchAfterClose, setWatchAfterClose] = useState<string>();
  useEffect(() => {
    /**
     * The card's Watch opens TV only once the card has closed. Closing returns
     * focus to the program block while the guide is still in front; done in
     * the same commit as opening TV, that focus would bring the guide back
     * over TV and take the keys from it.
     */
    if (!watchAfterClose || opened) return;
    setWatchAfterClose(undefined);
    onWatch(watchAfterClose);
  }, [watchAfterClose, opened, onWatch]);
  const blocks = schedule.data ? guideBlocks(schedule.data, windowStart) : [];
  return (
    <li className="guide-row">
      <div className="guide-channel">
        {channel.enabled ? (
          <button
            type="button"
            className="guide-tune"
            aria-label={`Watch ${channel.number} ${channel.name} on TV`}
            title={`Watch ${channel.number} ${channel.name} on TV`}
            onClick={() => onWatch(channel.id)}
          >
            <strong>{channel.number}</strong> {channel.name}
          </button>
        ) : (
          <>
            <strong>{channel.number}</strong> {channel.name}
            <span className="row-badge">Disabled</span>
          </>
        )}
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
                className={`guide-block${block.program ? "" : " off-air"}${
                  airingAt(block, now) ? " airing" : ""
                }`}
                style={{ left: block.left, width: block.width }}
              >
                {block.program ? (
                  <button
                    type="button"
                    className="guide-program"
                    title={blockTip(block.program, block)}
                    onClick={() => setOpened(block)}
                  >
                    <strong>{block.program.title}</strong>
                    {block.program.subTitle && (
                      <span>{block.program.subTitle}</span>
                    )}
                    <span>{markedTime(block.program, block.startsAt)}</span>
                  </button>
                ) : (
                  <>
                    <strong>Off air</strong>
                    <span>{displayClockTime(block.startsAt)}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {opened?.program && (
        <ProgramCard
          program={opened.program}
          channel={channel}
          startsAt={opened.startsAt}
          endsAt={opened.endsAt}
          onWatch={
            channel.enabled && airingAt(opened, now)
              ? () => {
                  setOpened(undefined);
                  setWatchAfterClose(channel.id);
                }
              : undefined
          }
          onClose={() => setOpened(undefined)}
        />
      )}
    </li>
  );
}

// Whether the block encloses the now line, so it is what the channel airs.
function airingAt(block: GuideBlock, now: number): boolean {
  return Date.parse(block.startsAt) <= now && now < Date.parse(block.endsAt);
}

// A block's last line: the episode's code or the movie's year, then its start time.
function markedTime(program: GuideProgram, startsAt: string): string {
  const mark = programMark(program);
  const time = displayClockTime(startsAt);
  return mark ? `${mark} · ${time}` : time;
}

// A block's tool tip: the whole of what the block may have cut short.
function blockTip(program: GuideProgram, block: GuideBlock): string {
  const parts = [program.title, program.subTitle, programMark(program)];
  return `${parts.filter(Boolean).join(" · ")} · ${displayTimeRange(block.startsAt, block.endsAt)}`;
}

/**
 * The window's programs and planned filler, as Off air, in time order, each
 * placed in the row; what ended before the window or starts after it is
 * left out.
 */
function guideBlocks(
  window: ScheduleWindow,
  windowStart: number,
): GuideBlock[] {
  return [
    ...window.entries.map((entry) => ({
      key: entry.id,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      program: entry.program,
    })),
    ...window.fillerIntervals.map((interval) => ({
      key: `off-air-${interval.startsAt}`,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      program: null,
    })),
  ]
    .flatMap((block) => {
      const place = placeBlock(block.startsAt, block.endsAt, windowStart);
      return place ? [{ ...block, ...place }] : [];
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

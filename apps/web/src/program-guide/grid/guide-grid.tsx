import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  displayClockTime,
  displayShortDay,
} from "../../controls/formatting/display-time.js";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import type { ProgramId } from "../../desktop/contracts.js";
import type { Channel } from "../../http/contracts/channels.js";
import { useRefreshScope } from "../../http/resources/refresh-scope.js";
import { useResource } from "../../http/resources/use-resource.js";
import {
  GUIDE_WIDTH_PX,
  HALF_HOUR_PX,
  hourMarks,
  guideStart,
  offsetPx,
} from "./guide-geometry.js";
import { GuideRow } from "./guide-row.js";

/** How often the now line moves while the guide is in view. */
const NOW_TICK_MS = 60_000;

/**
 * The guide grid: every channel down the side, 24 hours across from the top
 * of the current half hour, and a line at now. It draws what the server reports
 * and decides nothing; the one instant it takes from the browser is where
 * to draw the line. A channel's name opens it on TV; with no channels, the
 * empty state opens My Channels.
 */
export function GuideGrid({
  visible,
  onWatch,
  openProgram,
}: {
  visible: boolean;
  onWatch: (channelId: string) => void;
  /** Opens another program, such as My Channels when there is nothing to list. */
  openProgram: (id: ProgramId) => void;
}) {
  const channels = useResource<Channel[]>("/channels", visible);
  const { signal } = useRefreshScope();
  // The window moves to the current half hour whenever the program comes
  // back into view or its window reloads, so a restored or refocused guide
  // shows today rather than the hour it was left on. Adjusted during render
  // so the first visible paint already asks for it. Within one half hour the
  // start is unchanged, so a quiet reload keeps every row on screen.
  const [anchor, setAnchor] = useState({
    visible,
    revision: signal.revision,
    startsAt: guideStart(Date.now()),
  });
  if (anchor.visible !== visible || anchor.revision !== signal.revision) {
    setAnchor({
      visible,
      revision: signal.revision,
      startsAt: visible ? guideStart(Date.now()) : anchor.startsAt,
    });
  }
  const [now, setNow] = useState(Date.now);
  const scroll = useRef<HTMLDivElement>(null);
  // Brings the window back to the current half hour and the reader back to its left edge.
  const jumpToNow = () => {
    setAnchor((current) => ({ ...current, startsAt: guideStart(Date.now()) }));
    if (scroll.current) scroll.current.scrollLeft = 0;
  };
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const instant = Date.now();
      setNow(instant);
      // A guide left at its left edge follows the clock into the next half
      // hour; one scrolled ahead stays where the reader put it until Now.
      if (
        guideStart(instant) !== anchor.startsAt &&
        (scroll.current?.scrollLeft ?? 0) === 0
      ) {
        setAnchor((current) => ({ ...current, startsAt: guideStart(instant) }));
      }
    }, NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [visible, anchor.startsAt]);
  const nowLeft = offsetPx(now, anchor.startsAt);
  return (
    <section className="guide" aria-label="Program guide">
      <RequestFeedback loading={channels.loading} error={channels.error} />
      {channels.data?.length === 0 && (
        <p className="empty-state">
          No channels yet. Create one in My Channels.{" "}
          <button type="button" onClick={() => openProgram("channels")}>
            Open My Channels
          </button>
        </p>
      )}
      {channels.data && channels.data.length > 0 && (
        <div className="guide-scroll" ref={scroll}>
          <div
            className="guide-sheet"
            style={
              {
                "--guide-width": `${GUIDE_WIDTH_PX}px`,
                "--guide-half-hour": `${HALF_HOUR_PX}px`,
                "--guide-now": `${nowLeft}px`,
              } as CSSProperties
            }
          >
            <div className="guide-ruler">
              <div className="guide-corner">
                <button
                  type="button"
                  className="guide-now-button"
                  title="Back to the current half hour"
                  onClick={jumpToNow}
                >
                  Now
                </button>
              </div>
              <div className="guide-hours" aria-hidden="true">
                {hourMarks(anchor.startsAt).map((mark) => (
                  <span key={mark.instant} style={{ left: mark.left }}>
                    {markLabel(mark.instant)}
                  </span>
                ))}
              </div>
            </div>
            <ol className="guide-rows" aria-label="Channels">
              {channels.data.map((channel) => (
                <GuideRow
                  key={channel.id}
                  channel={channel}
                  windowStart={anchor.startsAt}
                  now={now}
                  visible={visible}
                  onWatch={onWatch}
                />
              ))}
            </ol>
            {nowLeft >= 0 && nowLeft <= GUIDE_WIDTH_PX && (
              <div className="guide-now" aria-hidden="true" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** An hour's label on the ruler: its time, or its day where one begins. */
function markLabel(instant: number): string {
  const iso = new Date(instant).toISOString();
  return new Date(instant).getHours() === 0
    ? displayShortDay(iso)
    : displayClockTime(iso);
}

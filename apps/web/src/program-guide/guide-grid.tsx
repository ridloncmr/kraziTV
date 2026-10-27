import { useEffect, useState, type CSSProperties } from "react";
import { displayClockTime, displayShortDay } from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { Channel } from "../http/contracts/channels.js";
import { useResource } from "../http/resources/use-resource.js";
import { GUIDE_WIDTH_PX, hourMarks, offsetPx } from "./guide-geometry.js";
import { GuideRow } from "./guide-row.js";

/** How often the now line moves while the guide is in view. */
const NOW_TICK_MS = 60_000;

/**
 * The guide grid: every channel down the side, the next 24 hours across,
 * and a line at now. It draws what the server reports and decides nothing;
 * the one instant it takes from the browser is where to draw the line.
 */
export function GuideGrid({ visible }: { visible: boolean }) {
  const channels = useResource<Channel[]>("/channels", visible);
  // The window starts at now each time the program comes back into view,
  // so a restored window shows today, not the day it was minimized on.
  // Adjusted during render so the first visible paint already asks for it.
  const [anchor, setAnchor] = useState({ visible, startsAt: Date.now() });
  if (anchor.visible !== visible) {
    setAnchor({ visible, startsAt: visible ? Date.now() : anchor.startsAt });
  }
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [visible]);
  const nowLeft = offsetPx(now, anchor.startsAt);
  return (
    <section className="guide" aria-label="Program guide">
      <RequestFeedback loading={channels.loading} error={channels.error} />
      {channels.data?.length === 0 && (
        <p className="empty-state">
          No channels yet. Open My Channels to create one.
        </p>
      )}
      {channels.data && channels.data.length > 0 && (
        <div className="guide-scroll">
          <div
            className="guide-sheet"
            style={
              {
                "--guide-width": `${GUIDE_WIDTH_PX}px`,
                "--guide-now": `${nowLeft}px`,
              } as CSSProperties
            }
          >
            <div className="guide-ruler" aria-hidden="true">
              <div className="guide-corner" />
              <div className="guide-hours">
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

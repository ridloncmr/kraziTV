import { Fragment, useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import {
  displayClockTime,
  displayDay,
  displayTimeRange,
  isSameDay,
} from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type {
  Channel,
  ChannelState,
  ScheduleWindow,
} from "../http/contracts/channels.js";
import { useResource } from "../http/resources/use-resource.js";
import { scheduleWindowPath } from "../schedule-view/schedule-window-path.js";

/** Guide and monitor share API observations; offsets are never advanced by browser time. */
export function ChannelObservation({
  visible,
  guide = false,
}: {
  visible: boolean;
  guide?: boolean;
}) {
  const channels = useResource<Channel[]>("/channels", visible);
  const [selected, setSelected] = useState("");
  const path = selected ? resourcePath("channels", selected) : null;
  const now = useResource<ChannelState>(
    path ? `${path}/now` : null,
    visible,
    10_000,
  );
  // The 24-hour window starts at now each time the program comes back into
  // view, so a restored window shows today, not the day it was minimized on.
  // Adjusted during render so the first visible paint already asks for it.
  const [anchor, setAnchor] = useState({ visible, startsAt: Date.now() });
  if (anchor.visible !== visible) {
    setAnchor({ visible, startsAt: visible ? Date.now() : anchor.startsAt });
  }
  const schedulePath =
    selected && guide ? scheduleWindowPath(selected, anchor.startsAt) : null;
  const schedule = useResource<ScheduleWindow>(schedulePath, visible);
  return (
    <>
      <div className="inline-form">
        <label>
          Channel
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a channel</option>
            {channels.data?.map((channel) => (
              <option value={channel.id} key={channel.id}>
                {channel.number} · {channel.name}
                {channel.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={now.loading || schedule.loading}
          onClick={() => {
            channels.refresh();
            now.refresh();
            schedule.refresh();
          }}
        >
          Refresh
        </button>
      </div>
      <RequestFeedback
        loading={channels.loading || now.loading || schedule.loading}
        error={channels.error}
      />
      {channels.data?.length === 0 && (
        <p className="empty-state">
          No channels yet. Open My Channels to create one.
        </p>
      )}
      {!selected && (channels.data?.length ?? 0) > 0 && (
        <p className="empty-state">Choose a channel to see what&apos;s on.</p>
      )}
      {selected && (
        <>
          <RequestFeedback error={now.error} />
          {now.data && (
            <fieldset>
              <legend>On now</legend>
              {now.data.currentItem ? (
                <dl className="facts">
                  <dt>On air</dt>
                  <dd>
                    <strong>{itemLabel(now.data.currentItem)}</strong>
                  </dd>
                  <dt>Position</dt>
                  <dd>
                    {now.data.currentItem.offsetMs === undefined
                      ? "Unavailable"
                      : displayDuration(now.data.currentItem.offsetMs)}
                  </dd>
                  <dt>Airtime</dt>
                  <dd>
                    {displayTimeRange(
                      now.data.currentItem.startsAt,
                      now.data.currentItem.endsAt,
                    )}
                  </dd>
                  <dt>Next program</dt>
                  <dd>
                    {now.data.nextItem
                      ? itemLabel(now.data.nextItem)
                      : "Nothing scheduled next"}
                  </dd>
                </dl>
              ) : (
                <p className="empty-state">
                  Nothing on air. {now.data.reason?.replaceAll("_", " ")}
                </p>
              )}
              <p className="secondary">
                As of {displayClockTime(now.data.evaluatedAt)}. Updates every 10
                seconds.
              </p>
            </fieldset>
          )}
          {guide && (
            <>
              <h2>Coming up</h2>
              <RequestFeedback error={schedule.error} />
              {schedule.data && guideRows(schedule.data).length === 0 && (
                <p className="empty-state">
                  Nothing scheduled yet. Add shows to this channel in My
                  Channels.
                </p>
              )}
              {schedule.data && guideRows(schedule.data).length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th>End</th>
                        <th>Program</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guideRows(schedule.data).map((row, index, rows) => (
                        <Fragment key={row.key}>
                          {/* A day heads its rows once, so each row carries only times. */}
                          {(index === 0 ||
                            !isSameDay(
                              rows[index - 1].startsAt,
                              row.startsAt,
                            )) && (
                            <tr className="day-row">
                              <th colSpan={3} scope="rowgroup">
                                {displayDay(row.startsAt)}
                              </th>
                            </tr>
                          )}
                          <tr>
                            <td>{displayClockTime(row.startsAt)}</td>
                            <td>{displayClockTime(row.endsAt)}</td>
                            <td>{row.label}</td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * Names what airs: a program by its title, planned filler as Off air with
 * the resume time the server worded in the programming timezone.
 */
function itemLabel(item: NonNullable<ChannelState["currentItem"]>): string {
  return item.type === "filler"
    ? `Off air — programming resumes at ${item.resumeTime}`
    : item.title;
}

/**
 * Lists the guide's rows in time order: each scheduled program, and each
 * planned filler interval as Off air, which is coverage, not an entry.
 */
function guideRows(window: ScheduleWindow) {
  return [
    ...window.entries.map((entry) => ({
      key: entry.id,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      label: entry.title,
    })),
    ...window.fillerIntervals.map((interval) => ({
      key: `off-air-${interval.startsAt}`,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      label: "Off air",
    })),
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

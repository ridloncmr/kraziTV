import { useMemo, useState } from "react";
import { displayTime } from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type {
  Channel,
  ChannelState,
  ScheduleWindow,
} from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";
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
  const schedulePath = useMemo(
    () => (selected && guide ? scheduleWindowPath(selected) : null),
    [selected, guide, visible],
  );
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
          No channels to inspect. Open My Channels to create one.
        </p>
      )}
      {!selected && (channels.data?.length ?? 0) > 0 && (
        <p className="empty-state">
          Choose a channel to inspect its backend-computed programming.
        </p>
      )}
      {selected && (
        <>
          <RequestFeedback error={now.error} />
          {now.data && (
            <fieldset>
              <legend>Current channel state</legend>
              {now.data.currentItem ? (
                <dl className="facts">
                  <dt>On air</dt>
                  <dd>
                    <strong>{itemLabel(now.data.currentItem)}</strong>
                  </dd>
                  <dt>Playback offset</dt>
                  <dd>{now.data.currentItem.offsetMs ?? "Unavailable"} ms</dd>
                  <dt>Airtime</dt>
                  <dd>
                    {displayTime(now.data.currentItem.startsAt)} –{" "}
                    {displayTime(now.data.currentItem.endsAt)}
                  </dd>
                  <dt>Next program</dt>
                  <dd>
                    {now.data.nextItem
                      ? itemLabel(now.data.nextItem)
                      : "No next program available"}
                  </dd>
                </dl>
              ) : (
                <p className="empty-state">
                  No current playout item.{" "}
                  {now.data.reason?.replaceAll("_", " ")}
                </p>
              )}
              <p className="secondary">
                Evaluated by server: {displayTime(now.data.evaluatedAt)}.
                Refreshes every 10 seconds while visible.
              </p>
            </fieldset>
          )}
          {guide && (
            <>
              <h2>Upcoming generated schedule</h2>
              <RequestFeedback error={schedule.error} />
              {schedule.data && guideRows(schedule.data).length === 0 && (
                <p className="empty-state">
                  No generated schedule entries. Check the channel's programming
                  source in My Channels.
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
                      {guideRows(schedule.data).map((row) => (
                        <tr key={row.key}>
                          <td>{displayTime(row.startsAt)}</td>
                          <td>{displayTime(row.endsAt)}</td>
                          <td>{row.label}</td>
                        </tr>
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

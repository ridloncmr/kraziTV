import { useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import {
  displayClockTime,
  displayTimeRange,
} from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { ProgramId } from "../desktop/contracts.js";
import { resourcePath } from "../http/api-client.js";
import type { Channel, ChannelState } from "../http/contracts/channels.js";
import { useResource } from "../http/resources/use-resource.js";
import { airingLabel, offAirWords } from "./airing-words.js";

/**
 * Live Monitor's view of one channel's current state; offsets are never
 * advanced by browser time. With no channels, the empty state opens My
 * Channels.
 */
export function ChannelObservation({
  visible,
  openProgram,
}: {
  visible: boolean;
  /** Opens another program, such as My Channels when there is nothing to observe. */
  openProgram: (id: ProgramId) => void;
}) {
  const channels = useResource<Channel[]>("/channels", visible);
  const [selected, setSelected] = useState("");
  const path = selected ? resourcePath("channels", selected) : null;
  const now = useResource<ChannelState>(
    path ? `${path}/now` : null,
    visible,
    10_000,
  );
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
          disabled={now.loading}
          onClick={() => {
            channels.refresh();
            now.refresh();
          }}
        >
          Refresh
        </button>
      </div>
      <RequestFeedback
        loading={channels.loading || now.loading}
        error={channels.error}
      />
      {channels.data?.length === 0 && (
        <p className="empty-state">
          No channels yet. Create one in My Channels.{" "}
          <button type="button" onClick={() => openProgram("channels")}>
            Open My Channels
          </button>
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
                    <strong>{airingLabel(now.data.currentItem)}</strong>
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
                      ? airingLabel(now.data.nextItem)
                      : "Nothing scheduled next"}
                  </dd>
                </dl>
              ) : (
                <p className="empty-state">{offAirWords(now.data.reason)}</p>
              )}
              <p className="secondary">
                As of {displayClockTime(now.data.evaluatedAt)}. Updates every 10
                seconds.
              </p>
            </fieldset>
          )}
        </>
      )}
    </>
  );
}

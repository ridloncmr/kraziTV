import { displayClockTime } from "../controls/display-time.js";
import { resourcePath } from "../http/api-client.js";
import type { Channel, ChannelState } from "../http/contracts/channels.js";
import { useResource } from "../http/resources/use-resource.js";
import { airingLabel, offAirWords } from "./airing-words.js";

// A glance at a list, not a monitor, so a minute matches the guide's now line.
const NOW_NEXT_POLL_MS = 60_000;

/**
 * What one channel airs now and next, for its row in My Channels. A disabled
 * channel broadcasts nothing, so it is never asked. A failed read stays a
 * quiet word in its cell, so one busy channel never fills the window with
 * alerts; the next poll tries again.
 */
export function ChannelNowNext({
  channel,
  visible,
}: {
  channel: Channel;
  visible: boolean;
}) {
  const now = useResource<ChannelState>(
    channel.enabled ? `${resourcePath("channels", channel.id)}/now` : null,
    visible,
    NOW_NEXT_POLL_MS,
  );
  if (!channel.enabled)
    return <span className="secondary">Not broadcasting</span>;
  if (!now.data)
    return (
      <span className="secondary">
        {now.error ? "Unavailable" : "Checking…"}
      </span>
    );
  const { currentItem, nextItem } = now.data;
  if (!currentItem)
    return <span className="secondary">{offAirWords(now.data.reason)}</span>;
  return (
    <>
      <span>{airingLabel(currentItem)}</span>
      {nextItem && (
        <small className="secondary now-next-line">
          Next at {displayClockTime(nextItem.startsAt)}: {airingLabel(nextItem)}
        </small>
      )}
    </>
  );
}

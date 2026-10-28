import { useEffect, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { Channel } from "../../http/contracts/channels.js";
import { useResource } from "../../http/resources/use-resource.js";
import {
  type ChannelTab,
  ChannelPropertySheet,
} from "./channel-property-sheet.js";

/**
 * The Channel Properties window: one channel's property sheet, in its own
 * window beside My Channels so it is in view the moment a channel is picked.
 * It reads the channel itself, so an identity change made here reaches the
 * title bar and My Channels through `onRead`. The tab stays while the window
 * is open, across channels.
 */
export function ChannelPropertiesApp({
  channelId,
  visible,
  onRead,
}: {
  channelId: string;
  visible: boolean;
  /** Reports each read of the channel, so the window title and list follow a rename. */
  onRead: (channel: Channel) => void;
}) {
  const channel = useResource<Channel>(
    resourcePath("channels", channelId),
    visible,
  );
  const [tab, setTab] = useState<ChannelTab>("general");
  useEffect(() => {
    if (channel.data) onRead(channel.data);
  }, [channel.data, onRead]);
  // Deleted elsewhere, such as from My Channels in another browser.
  const gone =
    channel.error instanceof ApiError && channel.error.status === 404;
  return (
    <div className="program-page">
      {gone ? (
        <p className="empty-state">This channel no longer exists.</p>
      ) : (
        <RequestFeedback
          loading={channel.loading && !channel.data}
          error={channel.error}
        />
      )}
      {channel.data && !gone && (
        <ChannelPropertySheet
          key={channel.data.id}
          channel={channel.data}
          visible={visible}
          tab={tab}
          onTabChange={setTab}
          changed={channel.refresh}
        />
      )}
    </div>
  );
}

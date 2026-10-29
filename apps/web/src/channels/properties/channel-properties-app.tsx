import { useEffect, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { ProgramId } from "../../desktop/contracts.js";
import type { PropertiesWindows } from "../../desktop/windows/use-properties-windows.js";
import type { Channel } from "../../http/contracts/channels.js";
import { useResource } from "../../http/resources/use-resource.js";
import {
  type ChannelTab,
  ChannelPropertySheet,
} from "./channel-property-sheet.js";

/**
 * The Channel Properties window: one channel's property sheet, in its own
 * window beside My Channels. It reads the channel itself for the title bar,
 * and reports an identity change saved here so My Channels reads its list
 * again. The tab stays while the window is open. An unsaved show goes to
 * `onDirtyChange`, so closing the window asks first.
 */
export function ChannelPropertiesApp({
  channelId,
  visible,
  windows,
  onDirtyChange,
  openProgram,
}: {
  channelId: string;
  visible: boolean;
  /** Channel Properties windows: this one's title and My Channels' list follow its saves. */
  windows: PropertiesWindows;
  onDirtyChange: (dirty: boolean) => void;
  /** Opens another program, which the lineup's show picker needs for Media Library. */
  openProgram: (id: ProgramId) => void;
}) {
  const channel = useResource<Channel>(
    resourcePath("channels", channelId),
    visible,
  );
  const [tab, setTab] = useState<ChannelTab>("general");
  const { read, changed } = windows;
  useEffect(() => {
    if (channel.data) read(channel.data);
  }, [channel.data, read]);
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
          onDirtyChange={onDirtyChange}
          openProgram={openProgram}
          changed={() => {
            channel.refresh();
            changed();
          }}
        />
      )}
    </div>
  );
}

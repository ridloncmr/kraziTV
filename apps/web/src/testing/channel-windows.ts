import { createElement, Fragment, useCallback, useState } from "react";
import { ChannelsApp } from "../channels/channels-app.js";
import { ChannelPropertiesApp } from "../channels/properties/channel-properties-app.js";
import type { Channel } from "../http/contracts/channels.js";

/**
 * My Channels beside a Channel Properties window per opened channel, wired
 * as the desktop shell wires them, so a test can open channels and use
 * their property sheets without the whole desktop. Opening a channel again
 * keeps its one window. `visible` stands for every window being shown or
 * minimized.
 */
export function ChannelWindows({ visible = true }: { visible?: boolean }) {
  const [opened, setOpened] = useState<readonly string[]>([]);
  const [revision, setRevision] = useState(0);
  // Stable, as the shell's is, so a read reports once rather than every render.
  const read = useCallback(() => setRevision((count) => count + 1), []);
  return createElement(
    Fragment,
    null,
    createElement(ChannelsApp, {
      visible,
      channelsRevision: revision,
      onShowProperties: (channel: Channel) =>
        setOpened((ids) =>
          ids.includes(channel.id) ? ids : [...ids, channel.id],
        ),
      onDeleted: (channelId: string) =>
        setOpened((ids) => ids.filter((id) => id !== channelId)),
    }),
    ...opened.map((channelId) =>
      createElement(ChannelPropertiesApp, {
        key: channelId,
        channelId,
        visible,
        onRead: read,
      }),
    ),
  );
}

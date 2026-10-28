import { createElement, Fragment, useState } from "react";
import { ChannelPropertiesApp } from "../channels/properties/channel-properties-app.js";
import { ChannelsApp } from "../channels/channels-app.js";
import type { Channel } from "../http/contracts/channels.js";

/**
 * My Channels beside Channel Properties, wired as the desktop shell wires
 * them, so a test can pick a channel and use its property sheet without the
 * whole desktop. Channel Properties renders only while a channel is open.
 * `visible` stands for both windows being shown or minimized.
 */
export function ChannelWindows({ visible = true }: { visible?: boolean }) {
  const [channel, setChannel] = useState<Channel>();
  return createElement(
    Fragment,
    null,
    createElement(ChannelsApp, {
      visible,
      propertiesChannel: channel,
      onShowProperties: setChannel,
      onCloseProperties: () => setChannel(undefined),
    }),
    channel &&
      createElement(ChannelPropertiesApp, {
        channelId: channel.id,
        visible,
        onRead: setChannel,
      }),
  );
}

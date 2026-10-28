import { createElement, Fragment } from "react";
import { ChannelsApp } from "../channels/channels-app.js";
import { ChannelPropertiesApp } from "../channels/properties/channel-properties-app.js";
import { propertiesTarget } from "../desktop/programs.js";
import { usePropertiesTestWindows } from "./properties-test-windows.js";

/**
 * My Channels beside a Channel Properties window per opened channel, wired
 * through the shell's own bookkeeping, so a test can open channels and use
 * their property sheets without the whole desktop. `visible` stands for
 * every window being shown or minimized.
 */
export function ChannelWindows({ visible = true }: { visible?: boolean }) {
  const windows = usePropertiesTestWindows();
  return createElement(
    Fragment,
    null,
    createElement(ChannelsApp, { visible, windows: windows.channels }),
    ...windows.open.map((id) =>
      createElement(ChannelPropertiesApp, {
        key: id,
        channelId: propertiesTarget(id)!.objectId,
        visible,
        windows: windows.channels,
      }),
    ),
  );
}

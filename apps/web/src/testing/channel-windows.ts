import { createElement, Fragment } from "react";
import { ChannelsApp } from "../channels/channels-app.js";
import { ChannelPropertiesApp } from "../channels/properties/channel-properties-app.js";
import { propertiesTarget } from "../desktop/programs.js";
import {
  PropertiesTestWindow,
  usePropertiesTestWindows,
} from "./properties-test-windows.js";

/**
 * My Channels beside a Channel Properties window per opened channel, wired
 * through the shell's own bookkeeping, so a test can open channels and use
 * their property sheets without the whole desktop. `visible` stands for
 * every window being shown or minimized. Each window is a region named for
 * its title, as on the desktop. `onWatch` stands for the shell opening TV.
 */
export function ChannelWindows({
  visible = true,
  onWatch = () => {},
}: {
  visible?: boolean;
  onWatch?: (channelId: string) => void;
}) {
  const windows = usePropertiesTestWindows();
  return createElement(
    Fragment,
    null,
    createElement(ChannelsApp, {
      visible,
      windows: windows.channels,
      onWatch,
    }),
    ...windows.open.map((id) =>
      createElement(PropertiesTestWindow, {
        key: id,
        id,
        windows,
        render: (onDirtyChange) =>
          createElement(ChannelPropertiesApp, {
            channelId: propertiesTarget(id)!.objectId,
            visible,
            windows: windows.channels,
            onDirtyChange,
          }),
      }),
    ),
  );
}

import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Channel } from "../http/contracts/channels.js";
import { adminFixtures } from "./admin-fixtures.js";
import type { BrowserApi } from "./browser-api.js";
import { ChannelWindows } from "./channel-windows.js";

/**
 * Opens one channel from My Channels and switches its Channel Properties to
 * `tab`, as the owner would. Rules and Preview appear once the lineup has
 * loaded with a show, so the tab is awaited rather than clicked at once.
 */
export async function openChannelTab(
  api: BrowserApi,
  tab: string,
  channel: Channel = adminFixtures.channels[0],
) {
  api.reply("/channels", [channel]);
  api.reply(`/channels/${channel.id}`, channel);
  const view = render(createElement(ChannelWindows));
  fireEvent.doubleClick(
    await screen.findByRole("button", { name: channel.name }),
  );
  fireEvent.click(await screen.findByRole("tab", { name: tab }));
  return view;
}

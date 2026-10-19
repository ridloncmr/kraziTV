import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChannelsApp } from "../channels/channels-app.js";
import type { Channel } from "../http/contracts/channels.js";
import { adminFixtures } from "./admin-fixtures.js";
import type { BrowserApi } from "./browser-api.js";

/**
 * Opens My Channels on one channel and switches its property sheet to
 * `tab`, as the owner would. Rules and Preview appear once the lineup has
 * loaded with a show, so the tab is awaited rather than clicked at once.
 */
export async function openChannelTab(
  api: BrowserApi,
  tab: string,
  channel: Channel = adminFixtures.channels[0],
) {
  api.reply("/channels", [channel]);
  const view = render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: channel.name }));
  fireEvent.click(await screen.findByRole("tab", { name: tab }));
  return view;
}

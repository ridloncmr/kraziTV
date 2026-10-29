import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProgramId } from "../desktop/contracts.js";
import type { Channel } from "../http/contracts/channels.js";
import { adminFixtures } from "./admin-fixtures.js";
import type { BrowserApi } from "./browser-api.js";
import { ChannelWindows } from "./channel-windows.js";

/**
 * Opens one channel from My Channels and switches its Channel Properties to
 * `tab`, as the owner would. Rules and Preview appear once the lineup has
 * loaded with a show, so the tab is awaited rather than clicked at once.
 * `openProgram` stands for the shell opening another program.
 */
export async function openChannelTab(
  api: BrowserApi,
  tab: string,
  channel: Channel = adminFixtures.channels[0],
  openProgram: (id: ProgramId) => void = () => {},
) {
  api.reply("/channels", [channel]);
  api.reply(`/channels/${channel.id}`, channel);
  const view = render(createElement(ChannelWindows, { openProgram }));
  fireEvent.doubleClick(
    await screen.findByRole("button", { name: channel.name }),
  );
  fireEvent.click(await screen.findByRole("tab", { name: tab }));
  return view;
}

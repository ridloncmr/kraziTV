import { memo } from "react";
import { AccountSettingsApp } from "../account-settings/account-settings-app.js";
import { ChannelPropertiesApp } from "../channels/properties/channel-properties-app.js";
import { ChannelsApp } from "../channels/channels-app.js";
import { CollectionsApp } from "../collections/collections-app.js";
import type { ProgramId } from "../desktop/contracts.js";
import type { AccountProfile } from "../http/contracts/auth.js";
import type { Channel } from "../http/contracts/channels.js";
import { LiveMonitorApp } from "../live-monitor/live-monitor-app.js";
import { MediaLibraryApp } from "../media-library/media-library-app.js";
import { PlexSetupApp } from "../plex-setup/plex-setup-app.js";
import { ProgramGuideApp } from "../program-guide/program-guide-app.js";

/**
 * Application composition maps navigation identity to programs without teaching windows domain behavior.
 * Memoized because the shell re-renders on every window move, focus and health poll; a program
 * re-renders only when its own state or these props change. The account changes identity only
 * when it is edited, and the app root keeps `onAccountChanged` stable; the shell keeps
 * `onTmdbKeyChanged`, `openProgram`, and the Channel Properties callbacks stable, changes
 * `tmdbTaskRequest` only when the tray asks, and `propertiesChannel` only when what it shows changes.
 */
export const ProgramContents = memo(function ProgramContents({
  id,
  visible,
  connection,
  account,
  onAccountChanged,
  tmdbTaskRequest,
  onTmdbKeyChanged,
  openProgram,
  propertiesChannel,
  showChannelProperties,
  channelRead,
  closeChannelProperties,
}: {
  id: ProgramId;
  visible: boolean;
  connection: string;
  account: AccountProfile;
  onAccountChanged: (account: AccountProfile) => void;
  tmdbTaskRequest: number;
  onTmdbKeyChanged: () => void;
  /** Opens another program, as a refusal's link to where it is resolved does. */
  openProgram: (id: ProgramId) => void;
  /** The channel Channel Properties shows while that window is open. */
  propertiesChannel: Channel | undefined;
  showChannelProperties: (channel: Channel) => void;
  channelRead: (channel: Channel) => void;
  closeChannelProperties: () => void;
}) {
  const openChannels = () => openProgram("channels");
  switch (id) {
    case "channels":
      return (
        <ChannelsApp
          visible={visible}
          propertiesChannel={propertiesChannel}
          onShowProperties={showChannelProperties}
          onCloseProperties={closeChannelProperties}
        />
      );
    case "channel-properties":
      return (
        propertiesChannel && (
          <ChannelPropertiesApp
            channelId={propertiesChannel.id}
            visible={visible}
            onRead={channelRead}
          />
        )
      );
    case "media":
      return (
        <MediaLibraryApp visible={visible} onOpenChannels={openChannels} />
      );
    case "collections":
      return <CollectionsApp visible={visible} onOpenChannels={openChannels} />;
    case "guide":
      return <ProgramGuideApp visible={visible} />;
    case "plex":
      return <PlexSetupApp visible={visible} />;
    case "monitor":
      return <LiveMonitorApp visible={visible} connection={connection} />;
    case "account":
      return (
        <AccountSettingsApp
          account={account}
          onAccountChanged={onAccountChanged}
          tmdbTaskRequest={tmdbTaskRequest}
          onTmdbKeyChanged={onTmdbKeyChanged}
        />
      );
  }
});

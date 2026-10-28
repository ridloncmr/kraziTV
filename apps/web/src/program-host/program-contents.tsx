import { memo, useCallback } from "react";
import { AccountSettingsApp } from "../account-settings/account-settings-app.js";
import { ChannelPropertiesApp } from "../channels/properties/channel-properties-app.js";
import { ChannelsApp } from "../channels/channels-app.js";
import { CollectionsApp } from "../collections/collections-app.js";
import { CollectionPropertiesApp } from "../collections/properties/collection-properties-app.js";
import type { ProgramId, WindowId } from "../desktop/contracts.js";
import { propertiesTarget } from "../desktop/programs.js";
import type { PropertiesWindows } from "../desktop/windows/use-properties-windows.js";
import type { AccountProfile } from "../http/contracts/auth.js";
import { LiveMonitorApp } from "../live-monitor/live-monitor-app.js";
import { MediaLibraryApp } from "../media-library/media-library-app.js";
import { PlexSetupApp } from "../plex-setup/plex-setup-app.js";
import { ProgramGuideApp } from "../program-guide/program-guide-app.js";

/**
 * Application composition maps navigation identity to programs without teaching windows domain behavior.
 * Memoized because the shell re-renders on every window move, focus and health poll; a program
 * re-renders only when its own state or these props change. The account changes identity only
 * when it is edited, and the app root keeps `onAccountChanged` stable; the shell keeps
 * `onTmdbKeyChanged`, `openProgram`, and `markUnsaved` stable, changes `tmdbTaskRequest` only
 * when the tray asks, and each kind's properties windows only when that kind saves a change.
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
  channelWindows,
  collectionWindows,
  markUnsaved,
}: {
  id: WindowId;
  visible: boolean;
  connection: string;
  account: AccountProfile;
  onAccountChanged: (account: AccountProfile) => void;
  tmdbTaskRequest: number;
  onTmdbKeyChanged: () => void;
  /** Opens another program, as a refusal's link to where it is resolved does. */
  openProgram: (id: ProgramId) => void;
  channelWindows: PropertiesWindows;
  collectionWindows: PropertiesWindows;
  /** Records whether a window holds unsaved changes, so closing it asks first. */
  markUnsaved: (id: WindowId, dirty: boolean) => void;
}) {
  const openChannels = () => openProgram("channels");
  // Bound to this window and stable, so an editor's dirty effect runs only when it changes.
  const onDirtyChange = useCallback(
    (dirty: boolean) => markUnsaved(id, dirty),
    [id, markUnsaved],
  );
  const target = propertiesTarget(id);
  if (target?.kind === "channel-properties")
    return (
      <ChannelPropertiesApp
        channelId={target.objectId}
        visible={visible}
        windows={channelWindows}
        onDirtyChange={onDirtyChange}
      />
    );
  if (target?.kind === "collection-properties")
    return (
      <CollectionPropertiesApp
        collectionId={target.objectId}
        visible={visible}
        windows={collectionWindows}
        onDirtyChange={onDirtyChange}
        onOpenChannels={openChannels}
      />
    );
  switch (id as ProgramId) {
    case "channels":
      return <ChannelsApp visible={visible} windows={channelWindows} />;
    case "media":
      return (
        <MediaLibraryApp visible={visible} onOpenChannels={openChannels} />
      );
    case "collections":
      return <CollectionsApp visible={visible} windows={collectionWindows} />;
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

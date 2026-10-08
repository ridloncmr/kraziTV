import { memo } from "react";
import type { ProgramId } from "../desktop/contracts.js";
import { ChannelsApp } from "../channels/channels-app.js";
import { CollectionsApp } from "../collections/collections-app.js";
import { MediaLibraryApp } from "../media-library/media-library-app.js";
import { ProgramGuideApp } from "../program-guide/program-guide-app.js";
import { PlexSetupApp } from "../plex-setup/plex-setup-app.js";
import { LiveMonitorApp } from "../live-monitor/live-monitor-app.js";
import { AccountSettingsApp } from "../account-settings/account-settings-app.js";
import type { AccountProfile } from "../http/contracts.js";

/**
 * Application composition maps navigation identity to programs without teaching windows domain behavior.
 * Memoized because the shell re-renders on every window move, focus and health poll; a program
 * re-renders only when its own state or these props change. The account changes identity only
 * when it is edited, and the app root keeps `onAccountChanged` stable.
 */
export const ProgramContents = memo(function ProgramContents({
  id,
  visible,
  connection,
  account,
  onAccountChanged,
}: {
  id: ProgramId;
  visible: boolean;
  connection: string;
  account: AccountProfile;
  onAccountChanged: (account: AccountProfile) => void;
}) {
  switch (id) {
    case "channels":
      return <ChannelsApp visible={visible} />;
    case "media":
      return <MediaLibraryApp visible={visible} />;
    case "collections":
      return <CollectionsApp visible={visible} />;
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
        />
      );
  }
});

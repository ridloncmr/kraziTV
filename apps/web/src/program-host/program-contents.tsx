import type { ProgramId } from "../desktop/contracts.js";
import { ChannelsApp } from "../channels/channels-app.js";
import { CollectionsApp } from "../collections/collections-app.js";
import { MediaLibraryApp } from "../media-library/media-library-app.js";
import { ProgramGuideApp } from "../program-guide/program-guide-app.js";
import { PlexSetupApp } from "../plex-setup/plex-setup-app.js";
import { LiveMonitorApp } from "../live-monitor/live-monitor-app.js";

/** Application composition maps navigation identity to programs without teaching windows domain behavior. */
export function ProgramContents({
  id,
  visible,
  connection,
}: {
  id: ProgramId;
  visible: boolean;
  connection: string;
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
  }
}

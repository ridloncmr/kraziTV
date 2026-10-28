import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { usePropertiesList } from "../desktop/windows/use-properties-list.js";
import type { PropertiesWindows } from "../desktop/windows/use-properties-windows.js";
import type {
  MediaCollection,
  MediaCollectionSummary,
} from "../http/contracts/collections.js";
import { useRefreshScope } from "../http/resources/refresh-scope.js";
import { useResource } from "../http/resources/use-resource.js";
import { NewAutomaticCollectionDialog } from "./automatic/new-automatic-collection-dialog.js";
import { DiscoverDialog } from "./discovery/discover-dialog.js";
import { CollectionGrid } from "./landing/collection-grid.js";
import { CreateCollectionDialog } from "./landing/create-collection-dialog.js";

/**
 * Collections select programming eligibility independently of filesystem
 * discovery roots. A card opens its collection in Collection Properties, a
 * window of its own beside this one, so the grid stays in view and several
 * collections can be open at once.
 */
export function CollectionsApp({
  visible,
  windows,
}: {
  visible: boolean;
  /** Each collection's own Collection Properties: opened from here. */
  windows: PropertiesWindows;
}) {
  const collections = useResource<MediaCollectionSummary[]>(
    "/media-collections",
    visible,
  );
  // Refresh reloads everything this window shows.
  const { refresh: refreshWindow } = useRefreshScope();
  const [tab, setTab] = useState<MediaCollection["maintenanceMode"]>("manual");
  // Which kind of collection a creation dialog is open for, if any.
  const [creating, setCreating] =
    useState<MediaCollection["maintenanceMode"]>();
  const [discovering, setDiscovering] = useState(false);
  // A save or delete in Collection Properties reads the grid again; a
  // created collection opens in its own window once its dialog has closed.
  const openCreated = usePropertiesList(
    windows,
    collections.refresh,
    creating !== undefined,
  );

  /** Closes a creation dialog and opens what it created, on the tab it belongs to. */
  function opened(collection: MediaCollection) {
    openCreated(collection);
    setCreating(undefined);
    setTab(collection.maintenanceMode);
    collections.refresh();
  }
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <div className="row-actions">
          <button onClick={refreshWindow}>Refresh</button>
        </div>
      </div>
      <p className="program-intro">
        Build ordered sets of media for your channels. Chronological playback
        follows this order.
      </p>
      <RequestFeedback
        loading={collections.loading}
        error={collections.error}
      />
      {collections.data && (
        <CollectionGrid
          collections={collections.data}
          tab={tab}
          onTabChange={setTab}
          onOpen={windows.show}
          onCreate={setCreating}
          onDiscover={() => setDiscovering(true)}
        />
      )}
      {creating === "manual" && (
        <CreateCollectionDialog
          created={opened}
          onClose={() => setCreating(undefined)}
        />
      )}
      {discovering && (
        <DiscoverDialog
          onCreated={collections.refresh}
          onClose={() => setDiscovering(false)}
        />
      )}
      {creating === "automatic" && (
        <NewAutomaticCollectionDialog
          created={opened}
          onClose={() => setCreating(undefined)}
        />
      )}
    </div>
  );
}

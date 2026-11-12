import { useState } from "react";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import { usePropertiesList } from "../desktop/windows/use-properties-list.js";
import type { PropertiesWindows } from "../desktop/windows/use-properties-windows.js";
import type {
  MediaCollection,
  MediaCollectionSummary,
} from "../http/contracts/collections.js";
import type { CollectionType } from "../collection-types/collection-type.js";
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
 * collections can be open at once. Each new `discoverRequest`, such as the
 * Collections ready balloon's, opens Discover, whether or not this window
 * was already open.
 */
export function CollectionsApp({
  visible,
  windows,
  discoverRequest,
  onRecommendationDecided,
}: {
  visible: boolean;
  /** Each collection's own Collection Properties: opened from here. */
  windows: PropertiesWindows;
  /** Counts requests to open Discover; 0 when none was made. */
  discoverRequest: number;
  /** Tells the shell Discover decided a recommendation, so its tray re-reads them. */
  onRecommendationDecided: () => void;
}) {
  const collections = useResource<MediaCollectionSummary[]>(
    "/media-collections",
    visible,
  );
  // Refresh reloads everything this window shows.
  const { refresh: refreshWindow } = useRefreshScope();
  const [tab, setTab] = useState<MediaCollection["maintenanceMode"]>("manual");
  // The Automatic tab's type filter; null shows every type.
  const [type, setType] = useState<CollectionType | null>(null);
  // Which kind of collection a creation dialog is open for, if any.
  const [creating, setCreating] =
    useState<MediaCollection["maintenanceMode"]>();
  const [discovering, setDiscovering] = useState(false);
  // Adjusted during render, not in an effect, so Discover shows on the
  // first paint after the request, whether or not this window was open.
  // The shell restarts the count only once this window has closed.
  const [handledRequest, setHandledRequest] = useState(0);
  if (discoverRequest !== handledRequest) {
    setHandledRequest(discoverRequest);
    setDiscovering(true);
  }
  // The tab holding what Discover created in this visit, if anything:
  // Automatic once any automatic collection was created, else Manual.
  const [discovered, setDiscovered] =
    useState<MediaCollection["maintenanceMode"]>();
  // A save or delete in Collection Properties reads the grid again; a
  // created collection opens in its own window once its dialog has closed.
  const openCreated = usePropertiesList(
    windows,
    collections.refresh,
    creating !== undefined,
  );

  /**
   * Closes a creation dialog and opens what it created, on the tab it
   * belongs to with no type filter, so its card is in view.
   */
  function opened(collection: MediaCollection) {
    openCreated(collection);
    setCreating(undefined);
    setTab(collection.maintenanceMode);
    setType(null);
    collections.refresh();
  }

  /** Notes a collection Discover created and reloads the grid behind the dialog. */
  function discoveredOne(collection: MediaCollection) {
    setDiscovered((current) =>
      current === "automatic" ? current : collection.maintenanceMode,
    );
    collections.refresh();
  }

  /**
   * Closes Discover on the tab holding what it created, with no type filter,
   * so the new cards are in view; creating nothing keeps the tab.
   */
  function closeDiscover() {
    setDiscovering(false);
    if (discovered) {
      setTab(discovered);
      setType(null);
    }
    setDiscovered(undefined);
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
        follows this order. Discover collections… suggests one per series and
        franchise.
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
          type={type}
          onTypeChange={setType}
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
          onCreated={discoveredOne}
          onRecommendationDecided={onRecommendationDecided}
          onClose={closeDiscover}
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

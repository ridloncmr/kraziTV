import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
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
  const { refresh } = collections;
  // A collection saved or deleted in Collection Properties changes its card,
  // so the grid reads again. The first render already reads it.
  const seenRevision = useRef(windows.revision);
  useEffect(() => {
    if (seenRevision.current === windows.revision) return;
    seenRevision.current = windows.revision;
    refresh();
  }, [windows.revision, refresh]);
  const [tab, setTab] = useState<MediaCollection["maintenanceMode"]>("manual");
  // Which kind of collection a creation dialog is open for, if any.
  const [creating, setCreating] =
    useState<MediaCollection["maintenanceMode"]>();
  const [discovering, setDiscovering] = useState(false);
  // A created collection opens in Collection Properties only once its
  // creation dialog has returned focus to this window, or that focus would
  // bring this window back over the one just opened.
  const created = useRef<MediaCollection>(undefined);
  useEffect(() => {
    if (creating || !created.current) return;
    windows.show(created.current);
    created.current = undefined;
  }, [creating, windows]);

  /** Closes a creation dialog and opens what it created, on the tab it belongs to. */
  function opened(collection: MediaCollection) {
    created.current = collection;
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

import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type {
  MediaCollection,
  MediaCollectionSummary,
} from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";
import { NewAutomaticCollectionDialog } from "./automatic/new-automatic-collection-dialog.js";
import { CollectionEditor } from "./editor/collection-editor.js";
import { CollectionGrid } from "./landing/collection-grid.js";
import { CreateCollectionDialog } from "./landing/create-collection-dialog.js";

/**
 * Collections select programming eligibility independently of filesystem
 * discovery roots. The landing grids open one collection's editor; leaving
 * it while a draft is unsaved is blocked, because the draft would be dropped
 * silently.
 */
export function CollectionsApp({ visible }: { visible: boolean }) {
  const collections = useResource<MediaCollectionSummary[]>(
    "/media-collections",
    visible,
  );
  const [tab, setTab] = useState<MediaCollection["maintenanceMode"]>("manual");
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  // Which kind of collection a creation dialog is open for, if any.
  const [creating, setCreating] =
    useState<MediaCollection["maintenanceMode"]>();
  const collection = collections.data?.find((item) => item.id === selected);

  /** Closes a creation dialog and opens what it created, on the tab it belongs to. */
  function opened(created: MediaCollection) {
    setCreating(undefined);
    setTab(created.maintenanceMode);
    setSelected(created.id);
    collections.refresh();
  }
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Collections</span>
        <div className="row-actions">
          <button onClick={collections.refresh}>Refresh</button>
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
      {collection ? (
        <>
          <div className="inline-form">
            <button disabled={dirty} onClick={() => setSelected("")}>
              All collections
            </button>
            {dirty && (
              <small className="secondary">
                Save or discard changes before leaving this collection.
              </small>
            )}
          </div>
          <h2>{collection.name}</h2>
          <CollectionEditor
            key={collection.id}
            collection={collection}
            visible={visible}
            changed={collections.refresh}
            deleted={() => {
              setSelected("");
              collections.refresh();
            }}
            onDirtyChange={setDirty}
          />
        </>
      ) : (
        collections.data && (
          <CollectionGrid
            collections={collections.data}
            tab={tab}
            onTabChange={setTab}
            onOpen={setSelected}
            onCreate={setCreating}
          />
        )
      )}
      {creating === "manual" && (
        <CreateCollectionDialog
          created={opened}
          onClose={() => setCreating(undefined)}
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

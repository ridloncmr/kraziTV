import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MediaCollection } from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";
import { CollectionEditor } from "./collection-editor.js";
import { CreateCollectionDialog } from "./create-collection-dialog.js";

/**
 * Collections select programming eligibility independently of filesystem
 * discovery roots. Switching or creating collections while a draft is unsaved
 * is blocked, because the editor's draft would be dropped silently.
 */
export function CollectionsApp({ visible }: { visible: boolean }) {
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const collection = collections.data?.find((item) => item.id === selected);
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Collections</span>
        <div className="row-actions">
          <button disabled={dirty} onClick={() => setCreating(true)}>
            New collection…
          </button>
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
      <div className="collections-layout">
        <nav className="collection-list" aria-label="Collection list">
          {collections.data?.length === 0 && (
            <div className="empty-state">
              <p>
                No collections yet. Create one, then add media from the catalog.
              </p>
              <button onClick={() => setCreating(true)}>
                Create a collection…
              </button>
            </div>
          )}
          <ul>
            {collections.data?.map((item) => (
              <li key={item.id}>
                <button
                  className={item.id === selected ? "selected-row" : ""}
                  aria-current={item.id === selected}
                  disabled={dirty && item.id !== selected}
                  onClick={() => setSelected(item.id)}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
          {dirty && (
            <small className="secondary">
              Save or discard changes before switching or creating collections.
            </small>
          )}
        </nav>
        <div className="collection-detail">
          {collection ? (
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
          ) : (
            collections.data?.length !== 0 && (
              <p className="empty-state">
                Choose a collection to edit its media.
              </p>
            )
          )}
        </div>
      </div>
      {creating && (
        <CreateCollectionDialog
          created={(result) => {
            setCreating(false);
            setSelected(result.id);
            collections.refresh();
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

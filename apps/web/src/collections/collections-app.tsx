import { formText } from "../controls/form-text.js";
import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MediaCollection } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { CollectionEditor } from "./collection-editor.js";

/**
 * Collections select programming eligibility independently of filesystem
 * discovery roots. Switching collections while a draft is unsaved is blocked,
 * because the editor's draft would be dropped silently.
 */
export function CollectionsApp({ visible }: { visible: boolean }) {
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const mutation = useMutation();
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const collection = collections.data?.find((item) => item.id === selected);
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Collections</span>
        <button onClick={collections.refresh}>Refresh</button>
      </div>
      <p className="program-intro">
        Build ordered sets of media for your channels. Chronological playback
        follows this order.
      </p>
      <RequestFeedback
        loading={collections.loading || mutation.pending}
        error={mutation.error ?? collections.error}
        message={mutation.message}
      />
      <div className="collections-layout">
        <nav className="collection-list" aria-label="Collection list">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void mutation.run<MediaCollection>(
                "/media-collections",
                "POST",
                { name: formText(new FormData(form), "name") },
                (result) => {
                  setSelected(result.id);
                  form.reset();
                  collections.refresh();
                },
              );
            }}
          >
            <fieldset disabled={mutation.pending || dirty}>
              <legend>New collection</legend>
              <label>
                New collection name
                <input name="name" required />
              </label>
              <button type="submit">Create collection</button>
            </fieldset>
          </form>
          {collections.data?.length === 0 && (
            <p className="empty-state">
              No collections yet. Create one, then add media from the catalog.
            </p>
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
              Save or discard changes before switching collections.
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
    </div>
  );
}

import { formText } from "../controls/form-text.js";
import { useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { MediaCollection, MediaItem } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { CollectionEditor } from "./collection-editor.js";

/** Collections select programming eligibility independently of filesystem discovery roots. */
export function CollectionsApp({ visible }: { visible: boolean }) {
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const media = useResource<MediaItem[]>("/media-items", visible);
  const mutation = useMutation();
  const [selected, setSelected] = useState("");
  const collection = collections.data?.find((item) => item.id === selected);
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Collections</span>
        <button
          onClick={() => {
            collections.refresh();
            media.refresh();
          }}
        >
          Refresh
        </button>
      </div>
      <p className="program-intro">
        Build ordered sets of media for your channels. Chronological playback
        follows this order.
      </p>
      <RequestFeedback
        loading={collections.loading || media.loading || mutation.pending}
        error={mutation.error ?? collections.error ?? media.error}
        message={mutation.message}
      />
      <form
        className="inline-form"
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
        <label>
          New collection name
          <input name="name" required disabled={mutation.pending} />
        </label>
        <button disabled={mutation.pending} type="submit">
          Create collection
        </button>
      </form>
      {collections.data?.length === 0 && (
        <p className="empty-state">
          No collections yet. Create one, then add media from the catalog.
        </p>
      )}
      <label>
        Collection
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a collection</option>
          {collections.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {collection && (
        <CollectionEditor
          key={collection.id}
          collection={collection}
          media={media.data ?? []}
          visible={visible}
          changed={collections.refresh}
        />
      )}
    </div>
  );
}

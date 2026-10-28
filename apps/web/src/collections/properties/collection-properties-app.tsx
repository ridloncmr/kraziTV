import { useEffect } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import type { PropertiesWindows } from "../../desktop/windows/use-properties-windows.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import { useResource } from "../../http/resources/use-resource.js";
import { CollectionEditor } from "../editor/collection-editor.js";

/**
 * The Collection Properties window: one collection's editor, in its own
 * window beside Collections. It reads the collection itself for the title
 * bar, and reports each save and delete so Collections reads its grid
 * again. An unsaved draft goes to `onDirtyChange`, so closing the window
 * asks before dropping it.
 */
export function CollectionPropertiesApp({
  collectionId,
  visible,
  windows,
  onDirtyChange,
  onOpenChannels,
}: {
  collectionId: string;
  visible: boolean;
  /** Collection Properties windows: this one's title and the grid follow its saves. */
  windows: PropertiesWindows;
  onDirtyChange: (dirty: boolean) => void;
  /** Opens My Channels, where a special blocking a delete is resolved. */
  onOpenChannels?: () => void;
}) {
  const collection = useResource<MediaCollection>(
    resourcePath("media-collections", collectionId),
    visible,
  );
  const { read, changed, deleted } = windows;
  useEffect(() => {
    if (collection.data) read(collection.data);
  }, [collection.data, read]);
  // Deleted elsewhere, such as in another browser.
  const gone =
    collection.error instanceof ApiError && collection.error.status === 404;
  return (
    <div className="program-page">
      {gone ? (
        <p className="empty-state">This collection no longer exists.</p>
      ) : (
        <RequestFeedback
          loading={collection.loading && !collection.data}
          error={collection.error}
        />
      )}
      {collection.data && !gone && (
        <>
          <h2>{collection.data.name}</h2>
          <CollectionEditor
            key={collection.data.id}
            collection={collection.data}
            visible={visible}
            changed={() => {
              collection.refresh();
              changed();
            }}
            deleted={() => deleted(collectionId)}
            onDirtyChange={onDirtyChange}
            onOpenChannels={onOpenChannels}
          />
        </>
      )}
    </div>
  );
}

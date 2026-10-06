import { formText } from "../controls/form-text.js";
import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type {
  CollectionMember,
  CollectionStatus,
  MediaCollection,
  MediaItem,
} from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { MediaItemPicker } from "../media-search/media-item-picker.js";

/** Draft order is form state; membership and schedulability become authoritative only after API writes. */
export function CollectionEditor({
  collection,
  visible,
  changed,
}: {
  collection: MediaCollection;
  visible: boolean;
  changed: () => void;
}) {
  const path = resourcePath("media-collections", collection.id);
  const members = useResource<CollectionMember[]>(`${path}/items`, visible);
  const status = useResource<CollectionStatus>(`${path}/status`, visible);
  const mutation = useMutation();
  const [ids, setIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<MediaItem>();
  // Unsaved additions are not members yet, so their titles come from the picker.
  const [picked, setPicked] = useState<MediaItem[]>([]);
  const dirty = useRef(false);
  useEffect(() => {
    if (members.data && !dirty.current)
      setIds(members.data.map((member) => member.mediaItemId));
  }, [members.data]);
  /** Moving an item preserves explicit membership order instead of sorting by title or ID. */
  function move(index: number, direction: number) {
    dirty.current = true;
    const reordered = [...ids];
    const [item] = reordered.splice(index, 1);
    reordered.splice(index + direction, 0, item);
    setIds(reordered);
  }
  return (
    <>
      <RequestFeedback
        loading={members.loading || status.loading || mutation.pending}
        error={mutation.error ?? members.error ?? status.error}
        message={mutation.message}
      />
      <fieldset disabled={mutation.pending}>
        <legend>Collection properties</legend>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutation.run(
              path,
              "PATCH",
              { name: formText(new FormData(event.currentTarget), "name") },
              changed,
            );
          }}
        >
          <label>
            Name
            <input name="name" defaultValue={collection.name} required />
          </label>
          <button type="submit">Rename</button>
        </form>
        {status.data && (
          <p className="info-strip">
            {status.data.schedulable ? "Schedulable" : "No schedulable media"} ·{" "}
            {status.data.schedulableCount} eligible of {status.data.memberCount}{" "}
            saved members
          </p>
        )}
      </fieldset>
      <fieldset disabled={mutation.pending || !members.data}>
        <legend>Media order</legend>
        <div className="inline-form">
          <MediaItemPicker
            label="Catalog media"
            value={adding?.id ?? ""}
            exclude={ids}
            visible={visible}
            onChange={setAdding}
          />
          <button
            disabled={!adding}
            onClick={() => {
              if (!adding) return;
              dirty.current = true;
              setIds([...ids, adding.id]);
              setPicked([...picked, adding]);
              setAdding(undefined);
            }}
          >
            Add media
          </button>
        </div>
        {ids.length === 0 && (
          <p className="empty-state">
            This collection has no media. Add cataloged items above.
          </p>
        )}
        <ol className="member-list">
          {ids.map((id, index) => {
            const item =
              members.data?.find((item) => item.mediaItemId === id) ??
              picked.find((item) => item.id === id);
            return (
              <li key={id}>
                <span>
                  {item?.title ?? id}
                  <small className="secondary">
                    {item?.status ?? "Unknown"}
                  </small>
                </span>
                <div className="row-actions">
                  <button
                    aria-label={`Move ${item?.title ?? id} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${item?.title ?? id} down`}
                    disabled={index === ids.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => {
                      dirty.current = true;
                      setIds(ids.filter((member) => member !== id));
                    }}
                    aria-label={`Remove ${item?.title ?? id}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <button
          onClick={() => {
            void mutation.run(
              `${path}/items`,
              "PUT",
              { mediaItemIds: ids },
              () => {
                dirty.current = false;
                members.refresh();
                status.refresh();
              },
            );
          }}
        >
          Save media order
        </button>
      </fieldset>
    </>
  );
}

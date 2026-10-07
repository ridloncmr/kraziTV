import { formText } from "../controls/form-text.js";
import { useEffect, useMemo, useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { resourcePath } from "../http/api-client.js";
import type {
  CollectionMember,
  CollectionStatus,
  MediaCollection,
} from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { CatalogPicker } from "./catalog-picker.js";
import type { DraftMember } from "./contracts.js";
import { MemberList } from "./member-list.js";
import { appendMedia } from "./member-order.js";

/** Draft order is form state; membership and schedulability become authoritative only after API writes. */
export function CollectionEditor({
  collection,
  visible,
  changed,
  deleted,
  onDirtyChange,
}: {
  collection: MediaCollection;
  visible: boolean;
  changed: () => void;
  deleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const path = resourcePath("media-collections", collection.id);
  const members = useResource<CollectionMember[]>(`${path}/items`, visible);
  const status = useResource<CollectionStatus>(`${path}/status`, visible);
  const mutation = useMutation();
  // `attempted` keeps an earlier rename or save error out of a newly opened confirmation.
  const [deleting, setDeleting] = useState<{ attempted: boolean }>();
  // Unsaved edits, or the order a save returned until the refetch replaces it,
  // so a save never flashes the old order back.
  const [local, setLocal] = useState<{
    members: DraftMember[];
    dirty: boolean;
  }>();
  useEffect(() => {
    setLocal((current) => (current?.dirty ? current : undefined));
  }, [members.data]);
  const dirty = local?.dirty ?? false;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const saved: readonly DraftMember[] = members.data ?? [];
  const draft = local?.members ?? saved;
  const memberIds = useMemo(
    () => new Set(draft.map((item) => item.mediaItemId)),
    [draft],
  );
  const runtimeMs = draft.reduce(
    (sum, item) => sum + (item.durationMs ?? 0),
    0,
  );

  /**
   * Every pane edit replaces the whole draft, which marks it unsaved. Edits
   * apply to the draft current when they land, so an addition that waited on
   * a request never overwrites edits made while it was pending.
   */
  function edit(change: (current: readonly DraftMember[]) => DraftMember[]) {
    setLocal((current) => ({
      members: change(current?.members ?? saved),
      dirty: true,
    }));
  }

  return (
    <>
      {/* An open confirmation reports its own request, so the editor does not repeat it. */}
      <RequestFeedback
        loading={
          members.loading || status.loading || (!deleting && mutation.pending)
        }
        error={
          (deleting ? undefined : mutation.error) ??
          members.error ??
          status.error
        }
        message={deleting ? undefined : mutation.message}
      />
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
          <input
            name="name"
            defaultValue={collection.name}
            required
            disabled={mutation.pending}
          />
        </label>
        <button disabled={mutation.pending} type="submit">
          Rename
        </button>
        <button
          disabled={mutation.pending}
          type="button"
          onClick={() => setDeleting({ attempted: false })}
        >
          Delete collection
        </button>
      </form>
      {deleting && (
        <WindowDialog
          title="Delete collection"
          busy={mutation.pending}
          onClose={() => setDeleting(undefined)}
        >
          <p>
            Delete collection <strong>{collection.name}</strong>? Its media stay
            in the catalog. A collection a channel programs from cannot be
            deleted.
          </p>
          <RequestFeedback
            loading={mutation.pending}
            error={deleting.attempted ? mutation.error : undefined}
          />
          <div className="dialog-actions">
            <button
              disabled={mutation.pending}
              onClick={() => {
                setDeleting({ attempted: true });
                void mutation.run(path, "DELETE", undefined, deleted);
              }}
            >
              Delete collection permanently
            </button>
            <button
              disabled={mutation.pending}
              onClick={() => setDeleting(undefined)}
            >
              Cancel
            </button>
          </div>
        </WindowDialog>
      )}
      {status.data && (
        <p className="info-strip">
          {status.data.schedulable ? "Schedulable" : "No schedulable media"} ·{" "}
          {status.data.schedulableCount} eligible of {status.data.memberCount}{" "}
          saved members
        </p>
      )}
      <div className="save-bar">
        <span>
          {draft.length} {draft.length === 1 ? "item" : "items"} ·{" "}
          {displayDuration(runtimeMs)} total
          {dirty && <strong> · Unsaved changes</strong>}
        </span>
        <div className="row-actions">
          <button
            disabled={!dirty || mutation.pending}
            onClick={() => setLocal(undefined)}
          >
            Discard changes
          </button>
          <button
            disabled={!dirty || mutation.pending}
            onClick={() => {
              void mutation.run<CollectionMember[]>(
                `${path}/items`,
                "PUT",
                { mediaItemIds: draft.map((item) => item.mediaItemId) },
                (saved) => {
                  setLocal({ members: saved, dirty: false });
                  members.refresh();
                  status.refresh();
                },
              );
            }}
          >
            Save changes
          </button>
        </div>
      </div>
      <fieldset
        className="collection-panes"
        disabled={mutation.pending || !members.data}
      >
        <CatalogPicker
          memberIds={memberIds}
          visible={visible}
          onAdd={(media) => edit((current) => appendMedia(current, media))}
        />
        <MemberList members={draft} onChange={(next) => edit(() => next)} />
      </fieldset>
    </>
  );
}

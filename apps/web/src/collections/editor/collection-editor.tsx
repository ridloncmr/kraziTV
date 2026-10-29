import { useEffect, useMemo, useState } from "react";
import { useUnsavedReport } from "../../desktop/windows/use-unsaved-report.js";
import { BlockingSpecials } from "../../controls/blocking-specials.js";
import { channelNumberIn } from "../../controls/channel-number.js";
import { displayDuration } from "../../controls/display-duration.js";
import { formText } from "../../controls/form-text.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { Channel } from "../../http/contracts/channels.js";
import type {
  CollectionMember,
  CollectionStatus,
  MediaCollection,
} from "../../http/contracts/collections.js";
import { useMutation, useResource } from "../../http/resources/use-resource.js";
import {
  criterionBasis,
  MaintenanceReport,
} from "../automatic/automatic-status.js";
import { ChangeCriterionDialog } from "../automatic/change-criterion-dialog.js";
import type { DraftMember } from "../contracts.js";
import { AutomaticMembers } from "./automatic-members.js";
import { CatalogPicker } from "./catalog-picker.js";
import { ConvertToManualDialog } from "./convert-to-manual-dialog.js";
import { MemberList } from "./member-list.js";
import { appendMedia } from "./member-order.js";

/**
 * Draft order is form state; membership and schedulability become
 * authoritative only after API writes. An automatic collection shows its
 * criterion and members read-only, since only the server maintains them;
 * rename and delete stay available.
 */
export function CollectionEditor({
  collection,
  visible,
  changed,
  deleted,
  onDirtyChange,
  onOpenChannels,
}: {
  collection: MediaCollection;
  visible: boolean;
  changed: () => void;
  deleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Opens My Channels, where a special blocking the delete is resolved. */
  onOpenChannels?: () => void;
}) {
  const path = resourcePath("media-collections", collection.id);
  const members = useResource<CollectionMember[]>(`${path}/items`, visible);
  const status = useResource<CollectionStatus>(`${path}/status`, visible);
  const mutation = useMutation();
  // `attempted` keeps an earlier rename or save error out of a newly opened confirmation.
  const [deleting, setDeleting] = useState<{ attempted: boolean }>();
  // Channel numbers name the specials a refused delete lists.
  const channels = useResource<Channel[]>(
    deleting?.attempted &&
      mutation.error instanceof ApiError &&
      mutation.error.code === "media_collection_in_use"
      ? "/channels"
      : null,
    visible,
  );
  const [converting, setConverting] = useState(false);
  const [changingCriterion, setChangingCriterion] = useState(false);
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
  useUnsavedReport(dirty, onDirtyChange);
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
        {collection.maintenanceMode === "automatic" && (
          <>
            <button
              disabled={mutation.pending}
              type="button"
              onClick={() => setChangingCriterion(true)}
            >
              Change criterion…
            </button>
            <button
              disabled={mutation.pending}
              type="button"
              onClick={() => setConverting(true)}
            >
              Convert to manual…
            </button>
          </>
        )}
      </form>
      {changingCriterion && (
        <ChangeCriterionDialog
          path={path}
          collection={collection}
          changed={() => {
            setChangingCriterion(false);
            members.refresh();
            status.refresh();
            changed();
          }}
          onClose={() => setChangingCriterion(false)}
        />
      )}
      {converting && (
        <ConvertToManualDialog
          path={path}
          name={collection.name}
          converted={() => {
            setConverting(false);
            members.refresh();
            status.refresh();
            changed();
          }}
          onClose={() => setConverting(false)}
        />
      )}
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
          <BlockingSpecials
            error={deleting.attempted ? mutation.error : undefined}
            channelNumber={(id) => channelNumberIn(channels.data, id)}
            onOpenChannels={onOpenChannels}
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
      {collection.maintenanceMode === "automatic" ? (
        <>
          <p className="info-strip">
            <strong>{criterionBasis(collection)}</strong> · Keeps every matching
            cataloged item in its default order as your catalog changes.
          </p>
          <MaintenanceReport collection={collection} />
          <p className="secondary">
            To add media or change the order, convert this collection to manual.
          </p>
          {members.data && (
            <AutomaticMembers
              path={path}
              members={members.data}
              visible={visible}
              changed={() => {
                members.refresh();
                status.refresh();
                changed();
              }}
            />
          )}
        </>
      ) : (
        <>
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
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  CollectionPreview,
  PlaybackMode,
  SourceAssignment,
} from "../../http/contracts/programming.js";
import { useResource } from "../../http/resources/use-resource.js";
import { PLAYBACK_MODE_CHOICES } from "../members/playback-mode-choices.js";
import { ProgrammingPreview } from "./programming-preview.js";
import { ProgressResetDialog } from "./progress-reset-dialog.js";

/**
 * Previews one of a saved assignment's collections in the mode being
 * edited, and offers **Restart from the beginning…** for it in the saved
 * mode. The server previews saved collections only, so a collection the
 * draft no longer holds has no preview until the draft is saved.
 */
export function CollectionPreviewSection({
  assignmentPath,
  assignment,
  draftMode,
  draftCollectionIds,
  collections,
  visible,
  changed,
  refreshKey,
}: {
  assignmentPath: string;
  assignment: SourceAssignment;
  /** The playback mode the draft shows, previewed even before it is saved. */
  draftMode: PlaybackMode;
  draftCollectionIds: readonly string[];
  collections: MediaCollection[] | undefined;
  visible: boolean;
  /** Runs after a reset the server accepted. */
  changed: () => void;
  /** Changes after each save, so the preview reads the saved order again. */
  refreshKey: number;
}) {
  const savedCollections = assignment.members.flatMap((member) =>
    member.kind === "collection" ? [member.mediaCollectionId] : [],
  );
  const savedMode = assignment.playbackMode;
  const [previewed, setPreviewed] = useState("");
  const [resetting, setResetting] = useState(false);
  const previewedId = savedCollections.includes(previewed)
    ? previewed
    : savedCollections[0];
  const preview = useResource<CollectionPreview>(
    previewedId !== undefined && draftCollectionIds.includes(previewedId)
      ? `${assignmentPath}/preview?mediaCollectionId=${encodeURIComponent(previewedId)}&playbackMode=${draftMode}`
      : null,
    visible,
  );
  const { refresh } = preview;
  // A save may change what the saved collection airs next, so read again.
  useEffect(() => {
    if (refreshKey > 0) refresh();
  }, [refreshKey, refresh]);
  // Reset applies to a saved collection in the saved mode, so it is offered
  // only while the draft shows them.
  const resettable =
    preview.data !== undefined && savedMode !== null && draftMode === savedMode;
  const collectionName = (id: string) =>
    collections?.find((collection) => collection.id === id)?.name ?? id;
  return (
    <section aria-label="Collection preview" className="form-stack">
      {savedCollections.length > 1 && previewedId !== undefined && (
        <label>
          Preview collection
          <select
            value={previewedId}
            onChange={(event) => setPreviewed(event.target.value)}
          >
            {savedCollections.map((id) => (
              <option key={id} value={id}>
                {collectionName(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {resettable && (
        <button type="button" onClick={() => setResetting(true)}>
          Restart from the beginning…
        </button>
      )}
      {resetting && previewedId !== undefined && savedMode && (
        <ProgressResetDialog
          path={`${assignmentPath}/progress-reset`}
          mediaCollectionId={previewedId}
          collectionName={
            collections?.find((collection) => collection.id === previewedId)
              ?.name ?? "This collection"
          }
          modeLabel={
            PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === savedMode)
              ?.label ?? savedMode
          }
          upcoming={preview.data?.upcoming ?? null}
          upcomingError={preview.error}
          reset={() => {
            preview.refresh();
            changed();
          }}
          onClose={() => setResetting(false)}
        />
      )}
      <RequestFeedback loading={preview.loading} error={preview.error} />
      {preview.data && <ProgrammingPreview preview={preview.data} />}
    </section>
  );
}

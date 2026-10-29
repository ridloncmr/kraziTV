import { CatalogFilterDialog } from "../catalog-filter/catalog-filter-dialog.js";
import type {
  MediaFilter,
  MediaItem,
  MediaRoot,
} from "../http/contracts/media.js";
import type { RetryScope } from "../http/contracts/metadata.js";
import { AddMediaRootDialog } from "./media-roots/add-media-root-dialog.js";
import { MatchChoiceDialog } from "./content-metadata/match-choice-dialog.js";
import { MediaDetailsDialog } from "./content-metadata/media-details-dialog.js";
import { ReviewMatchesDialog } from "./content-metadata/review-matches-dialog.js";
import { TrackMappingDialog } from "./content-metadata/track-mapping-dialog.js";
import { RemoveMediaDialog } from "./removal/remove-media-dialog.js";
import type { RemovalSubject } from "./removal/removal-messages.js";

/**
 * The one dialog the Media Library shows over its lists, with the subject it
 * was opened on. Items are as the listing reported them. The scan progress
 * dialog is not here: the scan job it follows decides when it opens.
 */
export type MediaLibraryDialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "filter" }
  | { kind: "remove"; subject: RemovalSubject }
  | { kind: "details"; item: MediaItem }
  | { kind: "choose"; item: MediaItem }
  | { kind: "map"; item: MediaItem }
  | { kind: "review" };

/**
 * Renders the Media Library's open dialog and moves between dialogs, such as
 * Details to Choose match. Every write a dialog makes reloads the lists
 * through `refresh`; requests whose outcome the page reports (a scan, a
 * lookup retry, a removal) go back to the page through their callbacks.
 */
export function MediaLibraryDialogs({
  dialog,
  onDialog,
  filter,
  roots,
  onFilter,
  onScan,
  onRetry,
  onRemoved,
  onOpenChannels,
  refresh,
}: {
  dialog: MediaLibraryDialog;
  /** Opens another dialog in the slot, or closes it with `none`. */
  onDialog: (dialog: MediaLibraryDialog) => void;
  /** The filter applied to the catalog list, which Filter starts from. */
  filter: MediaFilter;
  /** The listed roots, which Filter offers as choices. */
  roots: MediaRoot[] | undefined;
  /** The owner applied a new catalog filter. */
  onFilter: (applied: MediaFilter) => void;
  /** The owner chose to scan a root just added. */
  onScan: (root: Pick<MediaRoot, "id" | "path">) => void;
  /** The owner asked to look an item up on TMDB again. */
  onRetry: (scope: RetryScope) => void;
  /** A removal finished; the page reports it and clears its selection. */
  onRemoved: (feedback: string) => void;
  /** Opens My Channels, where a special blocking a removal is resolved. */
  onOpenChannels?: () => void;
  /** Reloads the page's lists after a write. */
  refresh: () => void;
}) {
  /** Empties the slot without reloading, for Cancel and the close box. */
  function close() {
    onDialog({ kind: "none" });
  }
  /** Empties the slot after a write, so the lists show what it changed. */
  function closeAndRefresh() {
    close();
    refresh();
  }
  switch (dialog.kind) {
    case "none":
      return null;
    case "add":
      return (
        <AddMediaRootDialog
          added={refresh}
          onScan={(root) => {
            close();
            onScan(root);
          }}
          onClose={close}
        />
      );
    case "filter":
      return (
        <CatalogFilterDialog
          applied={filter}
          roots={roots}
          onApply={(applied) => {
            close();
            onFilter(applied);
          }}
          onClose={close}
        />
      );
    case "remove":
      return (
        <RemoveMediaDialog
          subject={dialog.subject}
          removed={(feedback) => {
            close();
            onRemoved(feedback);
          }}
          onClose={close}
          onOpenChannels={onOpenChannels}
        />
      );
    case "details": {
      const { item } = dialog;
      return (
        <MediaDetailsDialog
          item={item}
          onChooseMatch={() => onDialog({ kind: "choose", item })}
          onMapTracks={() => onDialog({ kind: "map", item })}
          onRetry={(scope) => {
            close();
            onRetry({ scope, mediaItemId: item.id });
          }}
          onChanged={closeAndRefresh}
          onUpdated={(updated) => {
            onDialog({ kind: "details", item: updated });
            refresh();
          }}
          onClose={close}
        />
      );
    }
    case "choose":
      return (
        <MatchChoiceDialog
          mediaItemId={dialog.item.id}
          title={dialog.item.title}
          onDecided={closeAndRefresh}
          onClose={close}
        />
      );
    case "map":
      return (
        <TrackMappingDialog
          mediaItemId={dialog.item.id}
          onApplied={closeAndRefresh}
          onClose={close}
        />
      );
    case "review":
      return <ReviewMatchesDialog onClose={closeAndRefresh} />;
  }
}

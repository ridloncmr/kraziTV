import { useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import { displayTime } from "../controls/display-time.js";
import { withIds } from "../controls/id-selection.js";
import { Pager } from "../controls/pager.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { useRangeToggle } from "../controls/use-range-toggle.js";
import { resourcePath } from "../http/api-client.js";
import type {
  MediaFilter,
  MediaItem,
  MediaRoot,
} from "../http/contracts/media.js";
import type { ReviewStep } from "../http/contracts/metadata.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { useMediaItemPage } from "../media-search/use-media-item-page.js";
import { AddMediaRootDialog } from "./add-media-root-dialog.js";
import { CatalogFilterButton } from "./catalog-filter/catalog-filter-button.js";
import { MatchChoiceDialog } from "./content-metadata/match-choice-dialog.js";
import { matchStateLabel } from "./content-metadata/match-state-label.js";
import { MediaDetailsDialog } from "./content-metadata/media-details-dialog.js";
import { ReviewMatchesDialog } from "./content-metadata/review-matches-dialog.js";
import { TrackMappingDialog } from "./content-metadata/track-mapping-dialog.js";
import { RemoveMediaDialog } from "./removal/remove-media-dialog.js";
import type { RemovalSubject } from "./removal/removal-messages.js";
import { ScanProgressDialog } from "./scan-progress/scan-progress-dialog.js";
import { useScanJob } from "./scan-progress/use-scan-job.js";

const PAGE_SIZE = 50;

/**
 * Configures discovery locations, starts background scans, displays catalog
 * facts and each item's content metadata, and removes roots or selected
 * items. A scan's progress, a removal's outcome, and an item's match state
 * come from the server, never assumed here.
 */
export function MediaLibraryApp({
  visible,
  onOpenChannels,
}: {
  visible: boolean;
  /** Opens My Channels, where a special blocking a removal is resolved. */
  onOpenChannels?: () => void;
}) {
  const roots = useResource<MediaRoot[]>("/media-roots", visible);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MediaFilter>({});
  const media = useMediaItemPage(search, PAGE_SIZE, visible, { filter });
  const filtered = Object.keys(filter).length > 0;
  // Counts the Review matches steps; a failed read only hides the button.
  const review = useResource<{ steps: ReviewStep[] }>(
    "/metadata/match-reviews",
    visible,
  );
  const reviewCount = review.data?.steps.length ?? 0;
  const mutation = useMutation();
  const scan = useScanJob(roots.data);
  // Which request the feedback reports, so an earlier root write's success
  // never reads as the result of a scan start.
  const [lastRequest, setLastRequest] = useState<"root" | "scan" | "removal">(
    "root",
  );
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<RemovalSubject>();
  const [removalMessage, setRemovalMessage] = useState("");
  // The listed item whose details are open, as the listing reported it.
  const [detailed, setDetailed] = useState<MediaItem>();
  // The listed item whose candidates are open, and whether Review matches is.
  const [choosing, setChoosing] = useState<MediaItem>();
  const [reviewing, setReviewing] = useState(false);
  // The listed disc-track item whose folder is being mapped to episodes.
  const [mapping, setMapping] = useState<MediaItem>();
  // Selection is transient desktop shell state; it survives paging and search.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const range = useRangeToggle(
    media.data?.items.map((item) => item.id) ?? [],
    (id) => chosen.has(id),
    choose,
  );
  /** Chooses or releases catalog rows for removal. */
  function choose(ids: string[], on: boolean) {
    setChosen(withIds(chosen, ids, on));
  }
  /** Refreshes projections after a write without guessing new catalog availability. */
  function refresh() {
    roots.refresh();
    media.refresh();
    review.refresh();
  }
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Media Library</span>
        <div className="row-actions">
          <button onClick={() => setAdding(true)}>Add media root…</button>
          <button onClick={refresh}>Refresh</button>
        </div>
      </div>
      <p className="program-intro">
        Tell kraziTV where your media lives, then scan it into the catalog.
      </p>
      <RequestFeedback
        loading={roots.loading || mutation.pending || scan.starting}
        error={
          (lastRequest === "scan" ? scan.error : mutation.error) ??
          roots.error ??
          media.error
        }
        message={
          lastRequest === "root"
            ? mutation.message
            : lastRequest === "removal"
              ? removalMessage
              : undefined
        }
      />
      <fieldset disabled={mutation.pending || scan.starting}>
        <legend>Media roots</legend>
        {roots.data?.length === 0 && (
          <div className="empty-state">
            <p>
              No media roots yet. Add a path on the kraziTV server to get
              started.
            </p>
            <button onClick={() => setAdding(true)}>Add a media root…</button>
          </div>
        )}
        {roots.data && roots.data.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Server path</th>
                  <th>Last scan</th>
                  <th>Status</th>
                  <th>Matches</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roots.data.map((root) => (
                  <tr key={root.id}>
                    <td className="path-cell">{root.path}</td>
                    <td>
                      {root.lastScannedAt === null
                        ? "Not yet scanned"
                        : displayTime(root.lastScannedAt)}
                    </td>
                    <td>{root.enabled ? "Enabled" : "Disabled"}</td>
                    <td className="root-matches">
                      <RootMatches counts={root.matchCounts} />
                    </td>
                    <td>
                      <div className="row-actions root-actions">
                        <button
                          className="toggle-button"
                          onClick={() => {
                            setLastRequest("root");
                            void mutation.run(
                              resourcePath("media-roots", root.id),
                              "PATCH",
                              { enabled: !root.enabled },
                              refresh,
                            );
                          }}
                        >
                          {root.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          disabled={!root.enabled}
                          onClick={() => {
                            setLastRequest("scan");
                            void scan.start(root);
                          }}
                        >
                          Scan
                        </button>
                        <button
                          disabled={
                            !root.enabled ||
                            root.matchCounts.failedLookups === 0
                          }
                          onClick={() => {
                            setLastRequest("scan");
                            void scan.retry({
                              scope: "failed",
                              mediaRootId: root.id,
                            });
                          }}
                        >
                          Retry failed lookups
                        </button>
                        <button
                          onClick={() => setRemoving({ kind: "root", root })}
                        >
                          Delete…
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
      <div className="sticky-list-header">
        <h2>
          Cataloged media <small>({media.data?.total ?? 0})</small>
        </h2>
        <label className="search-field">
          Find media
          <input
            type="search"
            value={search}
            placeholder="Title or path"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="list-toolbar">
          <div
            className="row-actions filter-actions"
            role="group"
            aria-label="Matches"
          >
            <CatalogFilterButton
              applied={filter}
              roots={roots.data ?? []}
              onApply={setFilter}
            />
            <button
              disabled={reviewCount === 0}
              onClick={() => setReviewing(true)}
            >
              Review matches ({reviewCount})
            </button>
          </div>
          {media.data && (
            <Pager
              offset={media.offset}
              limit={PAGE_SIZE}
              total={media.data.total}
              onChange={media.setOffset}
            />
          )}
          <div className="row-actions" role="group" aria-label="Selected media">
            <button
              disabled={chosen.size === 0}
              onClick={() =>
                setRemoving({ kind: "items", mediaItemIds: [...chosen] })
              }
            >
              Delete…
            </button>
            <button
              disabled={chosen.size === 0}
              onClick={() => setChosen(new Set())}
            >
              Clear selection
            </button>
          </div>
        </div>
      </div>
      {media.data?.total === 0 && (
        <p className="empty-state">
          {search.trim()
            ? "No cataloged media matches this search."
            : filtered
              ? "No cataloged media matches these filters."
              : "The catalog is empty. Scan an enabled media root to discover media."}
        </p>
      )}
      {media.data && media.data.items.length > 0 && (
        <div className="table-scroll" aria-busy={media.loading}>
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Title / path</th>
                <th>Availability</th>
                <th>Duration</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {media.data.items.map((item) => (
                <tr
                  key={item.id}
                  className={`clickable-row${chosen.has(item.id) ? " selected-row" : ""}`}
                  {...range.row(item.id)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.title}`}
                      checked={chosen.has(item.id)}
                      onChange={range.checkbox(item.id)}
                    />
                  </td>
                  <td>
                    {item.title}
                    <small className="secondary path-cell">{item.path}</small>
                    {item.probeError && (
                      <small className="error-message">{item.probeError}</small>
                    )}
                  </td>
                  <td>{item.status}</td>
                  <td>{displayDuration(item.durationMs)}</td>
                  <td>
                    <div className="match-cell">
                      <span>{matchStateLabel(item.metadata)}</span>
                      <button
                        aria-label={`Details for ${item.title}`}
                        onClick={() => setDetailed(item)}
                      >
                        Details…
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <AddMediaRootDialog
          added={() => {
            setAdding(false);
            refresh();
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {removing && (
        <RemoveMediaDialog
          subject={removing}
          removed={(feedback) => {
            setRemoving(undefined);
            setLastRequest("removal");
            setRemovalMessage(feedback);
            setChosen(new Set());
            refresh();
          }}
          onClose={() => setRemoving(undefined)}
          onOpenChannels={onOpenChannels}
        />
      )}
      {detailed && (
        <MediaDetailsDialog
          item={detailed}
          onChooseMatch={() => {
            setDetailed(undefined);
            setChoosing(detailed);
          }}
          onMapTracks={() => {
            setDetailed(undefined);
            setMapping(detailed);
          }}
          onRetry={(scope) => {
            setDetailed(undefined);
            setLastRequest("scan");
            void scan.retry({ scope, mediaItemId: detailed.id });
          }}
          onChanged={() => {
            setDetailed(undefined);
            refresh();
          }}
          onUpdated={(updated) => {
            setDetailed(updated);
            refresh();
          }}
          onClose={() => setDetailed(undefined)}
        />
      )}
      {choosing && (
        <MatchChoiceDialog
          mediaItemId={choosing.id}
          title={choosing.title}
          onDecided={() => {
            setChoosing(undefined);
            refresh();
          }}
          onClose={() => setChoosing(undefined)}
        />
      )}
      {mapping && (
        <TrackMappingDialog
          mediaItemId={mapping.id}
          onApplied={() => {
            setMapping(undefined);
            refresh();
          }}
          onClose={() => setMapping(undefined)}
        />
      )}
      {reviewing && (
        <ReviewMatchesDialog
          onClose={() => {
            setReviewing(false);
            refresh();
          }}
        />
      )}
      {scan.followed && (
        <ScanProgressDialog
          key={scan.followed.status.id}
          job={scan.followed}
          visible={visible}
          onAcknowledge={() => {
            scan.acknowledge();
            refresh();
          }}
          onReview={() => {
            scan.acknowledge();
            refresh();
            setReviewing(true);
          }}
        />
      )}
    </div>
  );
}

/**
 * A root's match counts in a few words: how much of it is matched, then
 * what still needs the owner, shown only when there is some.
 */
function RootMatches({ counts }: { counts: MediaRoot["matchCounts"] }) {
  return (
    <>
      {counts.matched} of {counts.items} matched
      {counts.needsChoice > 0 && (
        <small className="secondary">
          {counts.needsChoice} need your choice
        </small>
      )}
      {counts.failedLookups > 0 && (
        <small className="secondary">
          {counts.failedLookups} failed{" "}
          {counts.failedLookups === 1 ? "lookup" : "lookups"}
        </small>
      )}
    </>
  );
}

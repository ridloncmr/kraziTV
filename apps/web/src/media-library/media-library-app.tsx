import { useRef, useState } from "react";
import { displayCount } from "../controls/formatting/display-count.js";
import { displayDuration } from "../controls/formatting/display-duration.js";
import { fileName } from "../controls/formatting/file-name.js";
import { displayTime } from "../controls/formatting/display-time.js";
import { withIds } from "../controls/selection/id-selection.js";
import { Pager } from "../controls/pager/pager.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import { RowMenu } from "../controls/popups/row-menu.js";
import { useRangeToggle } from "../controls/selection/use-range-toggle.js";
import { resourcePath } from "../http/api-client.js";
import type { MediaFilter, MediaRoot } from "../http/contracts/media.js";
import type { RetryScope, ReviewStep } from "../http/contracts/metadata.js";
import { useRefreshScope } from "../http/resources/refresh-scope.js";
import { useMutation, useResource } from "../http/resources/use-resource.js";
import { useMediaItemPage } from "../media-search/use-media-item-page.js";
import { AVAILABILITY_LABELS } from "../media-availability/availability-label.js";
import { keysInUse } from "../catalog-filter/catalog-filter-dialog.js";
import { matchStateLabel } from "./content-metadata/match-state-label.js";
import {
  MediaLibraryDialogs,
  type MediaLibraryDialog,
} from "./media-library-dialogs.js";
import { RootMatches } from "./media-roots/root-matches.js";
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
  const filtersInUse = keysInUse(filter);
  const list = useRef<HTMLDivElement>(null);
  // Counts the Review matches steps; a failed read only hides the button.
  const review = useResource<{ steps: ReviewStep[] }>(
    "/metadata/match-reviews",
    visible,
  );
  const reviewCount = review.data?.steps.length ?? 0;
  const mutation = useMutation();
  // Refresh reloads open dialogs too, not just the lists.
  const { refresh: refreshWindow } = useRefreshScope();
  const scan = useScanJob(roots.data);
  // Which request the feedback reports, so an earlier root write's success
  // never reads as the result of a scan start.
  const [lastRequest, setLastRequest] = useState<"root" | "scan" | "removal">(
    "root",
  );
  const [removalMessage, setRemovalMessage] = useState("");
  const [dialog, setDialog] = useState<MediaLibraryDialog>({ kind: "none" });
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
  /** Starts a root's scan, from its row, its menu, or the add dialog, and follows it in the progress dialog. */
  function startScan(root: Pick<MediaRoot, "id" | "path">) {
    setLastRequest("scan");
    void scan.start(root);
  }
  /** Looks an item, its folder, or a root's failed lookups up again, followed like a scan. */
  function retryLookups(scope: RetryScope) {
    setLastRequest("scan");
    void scan.retry(scope);
  }
  /** Reports a finished removal and releases the selection it removed. */
  function removed(feedback: string) {
    setLastRequest("removal");
    setRemovalMessage(feedback);
    setChosen(new Set());
    refresh();
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
        <div className="row-actions">
          <button onClick={() => setDialog({ kind: "add" })}>
            Add media root…
          </button>
          <button onClick={refreshWindow}>Refresh</button>
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
            <button onClick={() => setDialog({ kind: "add" })}>
              Add a media root…
            </button>
          </div>
        )}
        {roots.data && roots.data.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Server path</th>
                  <th>Last scan</th>
                  <th>Matches</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roots.data.map((root) => (
                  <tr key={root.id}>
                    <td className="path-cell">
                      {root.path}
                      {!root.enabled && (
                        <span className="row-badge">Disabled</span>
                      )}
                    </td>
                    <td>
                      {root.lastScannedAt === null
                        ? "Not yet scanned"
                        : displayTime(root.lastScannedAt)}
                    </td>
                    <td className="root-matches">
                      <RootMatches
                        counts={root.matchCounts}
                        scanned={root.lastScannedAt !== null}
                      />
                    </td>
                    <td>
                      <div className="root-actions">
                        {/* A root never scanned raises Scan beside the menu, so the first run finds it. */}
                        {root.lastScannedAt === null && (
                          <button
                            aria-label={`Scan ${root.path}`}
                            disabled={!root.enabled}
                            onClick={() => startScan(root)}
                          >
                            Scan
                          </button>
                        )}
                        <RowMenu
                          label={`Actions for ${root.path}`}
                          items={[
                            {
                              label: root.enabled ? "Disable" : "Enable",
                              onSelect: () => {
                                setLastRequest("root");
                                void mutation.run(
                                  resourcePath("media-roots", root.id),
                                  "PATCH",
                                  { enabled: !root.enabled },
                                  refresh,
                                );
                              },
                            },
                            {
                              label: "Scan",
                              disabled: !root.enabled,
                              onSelect: () => startScan(root),
                            },
                            {
                              label: "Retry failed lookups",
                              disabled:
                                !root.enabled ||
                                root.matchCounts.failedLookups === 0,
                              onSelect: () =>
                                retryLookups({
                                  scope: "failed",
                                  mediaRootId: root.id,
                                }),
                            },
                            {
                              label: "Delete…",
                              onSelect: () =>
                                setDialog({
                                  kind: "remove",
                                  subject: { kind: "root", root },
                                }),
                            },
                          ]}
                        />
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
          Cataloged media{" "}
          <small>({displayCount(media.data?.total ?? 0)})</small>
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
            <button onClick={() => setDialog({ kind: "filter" })}>
              {filtersInUse > 0 ? `Filter (${filtersInUse})…` : "Filter…"}
            </button>
            <button
              disabled={reviewCount === 0}
              onClick={() => setDialog({ kind: "review" })}
            >
              Review matches ({reviewCount})
            </button>
          </div>
          {media.data && (
            <Pager
              offset={media.offset}
              limit={PAGE_SIZE}
              total={media.data.total}
              list={list}
              onChange={media.setOffset}
            />
          )}
          <div className="row-actions" role="group" aria-label="Selected media">
            <button
              disabled={chosen.size === 0}
              onClick={() =>
                setDialog({
                  kind: "remove",
                  subject: { kind: "items", mediaItemIds: [...chosen] },
                })
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
            : filtersInUse > 0
              ? "No cataloged media matches these filters."
              : "The catalog is empty. Scan an enabled media root to discover media."}
        </p>
      )}
      {media.data && media.data.items.length > 0 && (
        <div ref={list} className="table-scroll" aria-busy={media.loading}>
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
                    {/* The file alone; Details shows the whole path. */}
                    <small className="secondary path-cell">
                      {fileName(item.path)}
                    </small>
                    {item.probeError && (
                      <small className="error-message">{item.probeError}</small>
                    )}
                  </td>
                  <td>{AVAILABILITY_LABELS[item.status]}</td>
                  <td>{displayDuration(item.durationMs)}</td>
                  <td>
                    <div className="match-cell">
                      <span>{matchStateLabel(item.metadata)}</span>
                      <button
                        aria-label={`Details for ${item.title}`}
                        onClick={() => setDialog({ kind: "details", item })}
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
      <MediaLibraryDialogs
        dialog={dialog}
        onDialog={setDialog}
        filter={filter}
        roots={roots.data}
        onFilter={setFilter}
        onScan={startScan}
        onRetry={retryLookups}
        onRemoved={removed}
        onOpenChannels={onOpenChannels}
        refresh={refresh}
      />
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
            setDialog({ kind: "review" });
          }}
        />
      )}
    </div>
  );
}

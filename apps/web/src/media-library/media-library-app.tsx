import { useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import { displayTime } from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import { Pager } from "../controls/pager.js";
import type { MediaRoot } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { useMediaItemPage } from "../media-search/use-media-item-page.js";
import { AddMediaRootDialog } from "./add-media-root-dialog.js";
import { ScanProgressDialog } from "./scan-progress/scan-progress-dialog.js";
import { useScanJob } from "./scan-progress/use-scan-job.js";

const PAGE_SIZE = 50;

/**
 * Configures discovery locations, starts background scans, and displays
 * catalog facts. A scan's progress and outcome show in its progress dialog,
 * read from the server, never assumed here.
 */
export function MediaLibraryApp({ visible }: { visible: boolean }) {
  const roots = useResource<MediaRoot[]>("/media-roots", visible);
  const [search, setSearch] = useState("");
  const media = useMediaItemPage(search, PAGE_SIZE, visible);
  const mutation = useMutation();
  const scan = useScanJob(roots.data);
  // Which request the feedback reports, so an earlier root write's success
  // never reads as the result of a scan start.
  const [lastRequest, setLastRequest] = useState<"root" | "scan">("root");
  const [adding, setAdding] = useState(false);
  /** Refreshes projections after a write without guessing new catalog availability. */
  function refresh() {
    roots.refresh();
    media.refresh();
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
        message={lastRequest === "root" ? mutation.message : undefined}
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roots.data.map((root) => (
                  <tr key={root.id}>
                    <td className="path-cell">{root.path}</td>
                    <td>{displayTime(root.lastScannedAt)}</td>
                    <td>{root.enabled ? "Enabled" : "Disabled"}</td>
                    <td>
                      <div className="row-actions">
                        <button
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
        {media.data && (
          <Pager
            offset={media.offset}
            limit={PAGE_SIZE}
            total={media.data.total}
            onChange={media.setOffset}
          />
        )}
      </div>
      {media.data?.total === 0 && (
        <p className="empty-state">
          {search.trim()
            ? "No cataloged media matches this search."
            : "The catalog is empty. Scan an enabled media root to discover media."}
        </p>
      )}
      {media.data && media.data.items.length > 0 && (
        <div className="table-scroll" aria-busy={media.loading}>
          <table>
            <thead>
              <tr>
                <th>Title / path</th>
                <th>Availability</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {media.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.title}
                    <small className="secondary path-cell">{item.path}</small>
                    {item.probeError && (
                      <small className="error-message">{item.probeError}</small>
                    )}
                  </td>
                  <td>{item.status}</td>
                  <td>{displayDuration(item.durationMs)}</td>
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
      {scan.followed && (
        <ScanProgressDialog
          key={scan.followed.status.id}
          job={scan.followed}
          visible={visible}
          onAcknowledge={() => {
            scan.acknowledge();
            refresh();
          }}
        />
      )}
    </div>
  );
}

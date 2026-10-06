import { formText } from "../controls/form-text.js";
import { useState } from "react";
import { displayTime } from "../controls/display-time.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import { Pager } from "../controls/pager.js";
import type { MediaRoot, ScanSummary } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { useMediaItemPage } from "../media-search/use-media-item-page.js";

const PAGE_SIZE = 50;

/** Configures discovery locations and displays real synchronous scan outcomes and catalog facts. */
export function MediaLibraryApp({ visible }: { visible: boolean }) {
  const roots = useResource<MediaRoot[]>("/media-roots", visible);
  const [search, setSearch] = useState("");
  const media = useMediaItemPage(search, PAGE_SIZE, visible);
  const mutation = useMutation();
  const [summary, setSummary] = useState<ScanSummary>();
  const [scanning, setScanning] = useState("");
  /** Refreshes projections after a write without guessing new catalog availability. */
  function refresh() {
    roots.refresh();
    media.refresh();
  }
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Media Library</span>
        <button onClick={refresh}>Refresh</button>
      </div>
      <p className="program-intro">
        Tell kraziTV where your media lives, then scan it into the catalog.
      </p>
      <RequestFeedback
        loading={roots.loading || mutation.pending}
        error={mutation.error ?? roots.error ?? media.error}
        message={mutation.message}
      />
      {scanning && mutation.pending && (
        <p role="status">
          Scanning {scanning}. Closing this program cancels its scan request.
        </p>
      )}
      <fieldset disabled={mutation.pending}>
        <legend>Media roots</legend>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void mutation.run(
              "/media-roots",
              "POST",
              { path: formText(new FormData(form), "path") },
              () => {
                form.reset();
                refresh();
              },
            );
          }}
        >
          <label>
            Absolute server path
            <input name="path" required placeholder="C:\Media or /srv/media" />
          </label>
          <button type="submit">Add root</button>
        </form>
        {roots.data?.length === 0 && (
          <p className="empty-state">
            No media roots yet. Add a path on the kraziTV server to get started.
          </p>
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
                            setScanning("");
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
                            setScanning(root.path);
                            setSummary(undefined);
                            void mutation.run<ScanSummary>(
                              `${resourcePath("media-roots", root.id)}/scan`,
                              "POST",
                              undefined,
                              (result) => {
                                setSummary(result);
                                refresh();
                              },
                            );
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
      {summary && (
        <fieldset>
          <legend>Completed scan</legend>
          <dl className="facts">
            <dt>Discovered</dt>
            <dd>{summary.discoveredCount}</dd>
            <dt>Probed</dt>
            <dd>{summary.probedCount}</dd>
            <dt>Probe failures</dt>
            <dd>{summary.probeFailedCount}</dd>
            <dt>Missing</dt>
            <dd>{summary.missingCount}</dd>
          </dl>
        </fieldset>
      )}
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
                  <td>
                    {item.durationMs === null
                      ? "Unknown"
                      : `${(item.durationMs / 1000).toFixed(1)} s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

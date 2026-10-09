import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { SegmentedProgressBar } from "../../controls/segmented-progress-bar.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { apiRequest } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { ScanStatus, TmdbKeyStatus } from "../../http/contracts.js";
import { toError } from "../../http/to-error.js";
import { useResource } from "../../http/use-resource.js";
import { ScanAnimation } from "./scan-animation.js";
import { isScanRunning, scanPath, type FollowedScan } from "./use-scan-job.js";

const counts = new Intl.NumberFormat("en-US");

/** The codes a poll answers with once the server no longer holds the job. */
const LOST_CODES = new Set(["scan_not_found", "media_root_not_found"]);

/**
 * Follows one scan job, the `id` it first saw, until the user acknowledges its
 * outcome. Render it keyed by that `id`, so a later job of the same root can
 * never inherit this one's polled status. While the job runs it is busy, so
 * neither the title bar nor Escape closes it; closing the window does not
 * cancel the scan.
 */
export function ScanProgressDialog({
  job,
  visible,
  onAcknowledge,
}: {
  job: FollowedScan;
  /** False while the window is minimized or the page hidden, which pauses polling. */
  visible: boolean;
  /** OK, or closing a finished dialog: the page closes it and refreshes. */
  onAcknowledge: () => void;
}) {
  const path = scanPath(job.status.rootId);
  // "sending" until the DELETE answers, then the status it answered with.
  const [cancelReply, setCancelReply] = useState<ScanStatus | "sending">();
  const ok = useRef<HTMLButtonElement>(null);
  const [cancelError, setCancelError] = useState<Error>();
  // Closing the dialog aborts a pending cancel, so its late answer, a 401
  // after the session ended included, never speaks for a later session.
  const cancelOwner = useRef<AbortController>(null);
  useEffect(() => () => cancelOwner.current?.abort(), []);
  // Set once the job can no longer change, so polling stops for good.
  const [ended, setEnded] = useState(false);
  const poll = useResource<ScanStatus>(path, visible && !ended, 1_000);
  const polled = poll.data ?? job.status;
  const ending =
    polled.id !== job.status.id
      ? "superseded"
      : poll.error instanceof ApiError && LOST_CODES.has(poll.error.code)
        ? "lost"
        : null;
  const running = ending === null && isScanRunning(polled);
  if (!running && !ended) setEnded(true);
  const completed = ending === null && polled.phase === "completed";
  // Read once the scan completes, so its summary can say why titles come
  // from file names; a failed read says nothing rather than guess.
  const tmdbKey = useResource<TmdbKeyStatus>(
    completed ? "/metadata/tmdb-key" : null,
  );

  // An ending replaces Cancel with OK; it takes focus unless the user has
  // moved on to another window meanwhile.
  useEffect(() => {
    const active = document.activeElement;
    const panel = ok.current?.closest(".window-dialog");
    if (!running && (active === document.body || panel?.contains(active)))
      ok.current?.focus();
  }, [running]);

  /**
   * Asks the server to cancel. Only the server's answer says whether it took
   * the request, since a job that has started committing ignores it.
   */
  async function cancel(button: HTMLButtonElement): Promise<void> {
    // Disabling the focused button would drop focus to the page, so the
    // dialog panel keeps it.
    button.closest<HTMLElement>(".window-dialog")?.focus();
    setCancelReply("sending");
    setCancelError(undefined);
    const controller = new AbortController();
    cancelOwner.current = controller;
    try {
      const reply = await apiRequest<ScanStatus>(path, {
        method: "DELETE",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setCancelReply(reply.id === job.status.id ? reply : undefined);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setCancelReply(undefined);
      setCancelError(toError(failure));
    }
  }

  const reply = cancelReply === "sending" ? undefined : cancelReply;
  const cancelling =
    cancelReply === "sending" ||
    reply?.cancelRequested === true ||
    polled.cancelRequested;
  const committing =
    polled.phase === "committing" || reply?.phase === "committing";
  return (
    <WindowDialog
      title="Scanning media root"
      busy={running}
      onClose={onAcknowledge}
    >
      <ScanAnimation
        animating={
          ending === null &&
          (polled.phase === "discovering" || polled.phase === "probing")
        }
      />
      <p role="status" aria-live="polite">
        {statusLine(polled, job.rootPath, ending)}
      </p>
      {running && <ScanProgress status={polled} />}
      {ending === null && polled.phase === "failed" && (
        <p>The catalog is unchanged.</p>
      )}
      {completed && tmdbKey.data?.configured === false && (
        <p>TMDB isn&apos;t set up, so titles come from file names.</p>
      )}
      {completed && polled.summary && (
        <dl className="facts">
          <dt>Discovered</dt>
          <dd>{counts.format(polled.summary.discoveredCount)}</dd>
          <dt>Probed</dt>
          <dd>{counts.format(polled.summary.probedCount)}</dd>
          <dt>Probe failures</dt>
          <dd>{counts.format(polled.summary.probeFailedCount)}</dd>
          <dt>Missing</dt>
          <dd>{counts.format(polled.summary.missingCount)}</dd>
        </dl>
      )}
      <RequestFeedback error={cancelError} />
      <div className="dialog-actions">
        {running ? (
          <button
            disabled={cancelling || committing}
            onClick={(event) => void cancel(event.currentTarget)}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        ) : (
          <button ref={ok} onClick={onAcknowledge}>
            OK
          </button>
        )}
      </div>
    </WindowDialog>
  );
}

/**
 * The live region's text. It depends on the phase and the job's fixed facts
 * only, so screen readers hear phase changes, never each count or file name.
 */
function statusLine(
  status: ScanStatus,
  rootPath: string,
  ending: "lost" | "superseded" | null,
): string {
  if (ending === "lost")
    return "This scan is no longer running on the server. The catalog may be unchanged; scan again.";
  if (ending === "superseded")
    return "A newer scan of this media root replaced this one.";
  switch (status.phase) {
    case "discovering":
      return `Looking for media files in ${rootPath}…`;
    case "probing":
      return "Probing media files…";
    case "committing":
      return "Saving to the catalog…";
    case "completed":
      return "Scan completed.";
    case "failed":
      return status.error?.message ?? "";
    case "cancelled":
      return "Scan cancelled. The catalog is unchanged.";
  }
}

/**
 * Counts and the progress bar of a running job, outside the live region.
 * Only probing knows its total, so the bar is determinate only then.
 */
function ScanProgress({ status }: { status: ScanStatus }) {
  const probing = status.phase === "probing";
  return (
    <>
      {probing && status.currentPath && (
        <p className="path-cell">Last probed: {fileName(status.currentPath)}</p>
      )}
      <SegmentedProgressBar
        label="Scan progress"
        progress={
          probing
            ? {
                value: status.settledCount,
                max: Math.max(status.discoveredCount, 1),
              }
            : undefined
        }
      />
      <p>
        {probing
          ? `${counts.format(status.settledCount)} of ${counts.format(status.discoveredCount)} files`
          : `${counts.format(status.discoveredCount)} found`}
      </p>
    </>
  );
}

/** The server reports full paths on either platform; the dialog names only the file. */
function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

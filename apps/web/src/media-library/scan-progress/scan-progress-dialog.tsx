import { Fragment, useEffect, useRef, useState } from "react";
import { displayCount } from "../../controls/display-count.js";
import { fileName } from "../../controls/file-name.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { SegmentedProgressBar } from "../../controls/segmented-progress-bar.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { apiRequest } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { TmdbKeyStatus } from "../../http/contracts/metadata.js";
import type { ScanStatus } from "../../http/contracts/scan.js";
import { toError } from "../../http/to-error.js";
import { useResource } from "../../http/resources/use-resource.js";
import { ScanAnimation } from "./scan-animation.js";
import { isScanRunning, scanPath, type FollowedScan } from "./use-scan-job.js";

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
  onReview,
}: {
  job: FollowedScan;
  /** False while the window is minimized or the page hidden, which pauses polling. */
  visible: boolean;
  /** OK, or closing a finished dialog: the page closes it and refreshes. */
  onAcknowledge: () => void;
  /** Acknowledges a scan that left items needing a choice and opens Review matches. */
  onReview: () => void;
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
  // Items this scan left needing the owner's choice; only a completed scan reports them.
  const needChoice = completed ? (polled.summary?.ambiguousCount ?? 0) : 0;
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
      title={
        job.status.kind === "retry"
          ? "Retrying TMDB lookups"
          : "Scanning media root"
      }
      busy={running}
      onClose={onAcknowledge}
    >
      <ScanAnimation
        animating={
          ending === null &&
          (polled.phase === "discovering" ||
            polled.phase === "probing" ||
            polled.phase === "enriching")
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
      {completed && polled.kind === "retry" && polled.lookupCount === 0 && (
        <p>Nothing here needed a lookup.</p>
      )}
      {completed && polled.summary && (
        <dl className="facts">
          {summaryFacts(polled, polled.summary).map(([label, count]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{displayCount(count)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {needChoice > 0 && <p>{displayCount(needChoice)} need your choice.</p>}
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
          <>
            {needChoice > 0 && (
              <button onClick={onReview}>Review matches…</button>
            )}
            <button ref={ok} onClick={onAcknowledge}>
              OK
            </button>
          </>
        )}
      </div>
    </WindowDialog>
  );
}

/**
 * A completed job's summary as the owner reads it: what the scan found and
 * what the lookups decided, in the words the match review uses. A retry never
 * discovers or probes, so it lists lookups only; a scan that looked nothing
 * up lists files only. Probed files are the found files that could be read,
 * so they are not listed again.
 */
function summaryFacts(
  status: ScanStatus,
  summary: NonNullable<ScanStatus["summary"]>,
): [label: string, count: number][] {
  const files: [string, number][] =
    status.kind === "scan"
      ? [
          ["Files found", summary.discoveredCount],
          ["Could not be read", summary.probeFailedCount],
          ["Missing", summary.missingCount],
        ]
      : [];
  const lookups: [string, number][] =
    status.lookupCount > 0
      ? [
          ["Identified on TMDB", summary.matchedCount],
          ["Need your choice", summary.ambiguousCount],
          ["Not identified", summary.unmatchedCount],
          ["Lookup failed", summary.lookupErrorCount],
        ]
      : [];
  return [...files, ...lookups];
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
    case "enriching":
      return "Looking up media on TMDB…";
    case "committing":
      return "Saving to the catalog…";
    case "completed":
      return status.kind === "retry"
        ? "Lookup retry completed."
        : "Scan completed.";
    case "failed":
      return status.error?.message ?? "";
    case "cancelled":
      return "Scan cancelled. The catalog is unchanged.";
  }
}

/**
 * Counts and the progress bar of a running job, outside the live region.
 * Only probing and enriching know their totals, so the bar is determinate
 * only then.
 */
function ScanProgress({ status }: { status: ScanStatus }) {
  const step = progressStep(status);
  return (
    <>
      {step?.last && <p className="path-cell">{step.last}</p>}
      <SegmentedProgressBar
        label="Scan progress"
        progress={step && { value: step.done, max: Math.max(step.total, 1) }}
      />
      <p>
        {step
          ? `${displayCount(step.done)} of ${displayCount(step.total)} ${step.unit}`
          : `${displayCount(status.discoveredCount)} found`}
      </p>
    </>
  );
}

/** The determinate step a running job is in, or undefined while its total is unknown. */
function progressStep(status: ScanStatus) {
  if (status.phase === "probing") {
    return {
      done: status.settledCount,
      total: status.discoveredCount,
      unit: "files",
      last:
        status.currentPath && `Last probed: ${fileName(status.currentPath)}`,
    };
  }
  if (status.phase === "enriching") {
    return {
      done: status.lookedUpCount,
      total: status.lookupCount,
      unit: "looked up",
      last: status.currentTitle && `Last looked up: ${status.currentTitle}`,
    };
  }
  return undefined;
}

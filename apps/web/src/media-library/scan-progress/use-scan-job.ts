import { useEffect, useRef, useState } from "react";
import { apiRequest, resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type {
  MediaRoot,
  RetryScope,
  ScanStatus,
} from "../../http/contracts.js";
import { toError } from "../../http/to-error.js";

/** The scan job a progress dialog follows, with the root path its status line names. */
export interface FollowedScan {
  rootPath: string;
  status: ScanStatus;
}

/** The phases after which a scan job never changes again. */
const TERMINAL_PHASES: ReadonlySet<ScanStatus["phase"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/** A running job still changes on the server, so its dialog keeps polling and stays busy. */
export function isScanRunning(status: ScanStatus): boolean {
  return !TERMINAL_PHASES.has(status.phase);
}

/** The scan route of one media root, shared by start, poll, and cancel. */
export function scanPath(rootId: string): string {
  return `${resourcePath("media-roots", rootId)}/scan`;
}

/**
 * Chooses which scan job the Media Library's progress dialog follows: one this
 * page started, one another client started (`409` `scan_in_progress`), or the
 * first running job in media-root order once the dialog is free. Which job is
 * followed and which were acknowledged is transient page state; every outcome
 * shown comes from the server's status.
 */
export function useScanJob(roots: MediaRoot[] | undefined) {
  const owner = useRef<AbortController | null>(null);
  const [followed, setFollowed] = useState<FollowedScan | null>(null);
  // Jobs the user closed with OK; a list read before the close still shows
  // them running, and must not reopen them.
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The list on screen when the user last pressed OK. Scans in it may have
  // finished since, so reattaching waits for the refreshed list.
  const [staleRoots, setStaleRoots] = useState<MediaRoot[]>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<Error>();

  // A closed program abandons its pending start; the server keeps any scan it began.
  useEffect(() => () => owner.current?.abort(), []);

  // Reattaches only while no dialog is open, so a job never opens twice.
  useEffect(() => {
    if (followed || roots === staleRoots) return;
    const root = roots?.find(
      (candidate) =>
        candidate.scan &&
        isScanRunning(candidate.scan) &&
        !acknowledged.has(candidate.scan.id),
    );
    if (root?.scan) setFollowed({ rootPath: root.path, status: root.scan });
  }, [roots, followed, acknowledged, staleRoots]);

  /**
   * Opens the dialog only for a job the server holds: the started one, or the
   * running one a `409` `scan_in_progress` names. Any other rejection is the
   * page's request feedback, with no dialog.
   */
  async function start(root: MediaRoot): Promise<void> {
    const path = scanPath(root.id);
    await follow((signal) =>
      apiRequest<ScanStatus>(path, { method: "POST", signal }).catch(
        (failure: unknown) => {
          if (
            failure instanceof ApiError &&
            failure.code === "scan_in_progress"
          )
            return apiRequest<ScanStatus>(path, { signal });
          throw failure;
        },
      ),
    );
  }

  /**
   * Starts a lookup retry and opens the dialog on the job it started. A
   * refusal, a running scan's `409` included, is the page's request feedback:
   * an item's retry does not name the root whose job is running.
   */
  async function retry(scope: RetryScope): Promise<void> {
    await follow((signal) =>
      apiRequest<ScanStatus>("/metadata/lookup-retries", {
        method: "POST",
        body: scope,
        signal,
      }),
    );
  }

  /**
   * Runs one start request at a time and follows the job it answers with,
   * unless this program closed meanwhile or a dialog is already open.
   */
  async function follow(
    request: (signal: AbortSignal) => Promise<ScanStatus>,
  ): Promise<void> {
    if (owner.current) return;
    const controller = new AbortController();
    owner.current = controller;
    setStarting(true);
    setError(undefined);
    try {
      const status = await request(controller.signal);
      const rootPath =
        roots?.find((root) => root.id === status.rootId)?.path ?? "";
      if (!controller.signal.aborted)
        setFollowed((current) => current ?? { rootPath, status });
    } catch (failure) {
      if (!controller.signal.aborted) setError(toError(failure));
    } finally {
      owner.current = null;
      if (!controller.signal.aborted) setStarting(false);
    }
  }

  /** Closes the dialog and frees it for the next running job in a list read after this close. */
  function acknowledge(): void {
    if (!followed) return;
    const id = followed.status.id;
    setAcknowledged((current) => new Set(current).add(id));
    setStaleRoots(roots);
    setFollowed(null);
  }

  return { followed, starting, error, start, retry, acknowledge };
}

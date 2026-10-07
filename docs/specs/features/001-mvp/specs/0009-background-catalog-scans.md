# Background Catalog Scans

Status: Implemented

This spec replaces the synchronous scan trigger from
[0002-media-catalog](0002-media-catalog.md) with a background scan job that
reports progress. It also replaces the Media Library's pending scan state from
[0008-web-admin](0008-web-admin.md) with a progress dialog that locks the
window. Everything else about a catalog scan stays the same: discovery, probe
concurrency, candidate validation, atomic commit, and missing reconciliation.

## Problem

Scanning a large media root takes minutes. The server holds
`POST /media-roots/:id/scan` open for the whole scan, the web client waits up
to an hour for it, and the Media Library shows only one line of status text.
Closing the window cancels the scan. Nobody can tell whether a scan is making
progress or has stalled.

Discovery is async filesystem I/O and probing runs in `ffprobe` child
processes, so the event loop is mostly free during a scan. The one exception is
the commit. better-sqlite3 is synchronous, and the writer runs one statement per
media item inside a single transaction. On a large root that can hold the event
loop long enough to delay broadcast signal I/O.

## Goals

- Start a scan with a request that returns right away; the scan runs in the
  background on the server.
- Report each scan's phase and counts while it runs.
- Keep a scan running when its window closes or the browser leaves, and cancel
  it only on explicit request or server shutdown.
- Show scan progress in a window dialog that locks only the Media Library
  window.
- Keep the commit from blocking the event loop long enough to disturb
  wall-clock pacing.

## Non-goals

- Persisting scan jobs across server restarts. A restart loses the running
  job; because the commit is atomic, the catalog is unchanged and the user
  rescans.
- A general job queue, worker threads, or an external queue such as Redis.
- Push updates (SSE or WebSockets). Polling is enough for now.
- Scan history beyond the latest job for each root.
- Scheduled or filesystem-watch rescans.
- Any change to what a scan discovers, probes, or commits.

## User-Facing Behavior

### Starting a scan

1. The user selects **Scan** on an enabled media root.
2. A **Scanning media root** window dialog opens over the Media Library
   window. Its content is inert, and while the scan runs the dialog's close
   button is disabled and Escape does nothing. Other windows, the taskbar, and
   Start stay usable.
3. The dialog opens only once the server has started the scan (`202`). If
   another client already started a scan of that root (`409`
   `scan_in_progress`), the dialog attaches to that scan instead of reporting
   an error. Any other rejection, such as a disabled or deleted root, shows in
   the Media Library's existing request feedback and opens no dialog.

### Progress dialog

The dialog shows an animation, a status line, a progress bar, counts, and a
**Cancel** button.

| Phase         | Status line                                             | Progress bar                    | Counts                 |
| ------------- | ------------------------------------------------------- | ------------------------------- | ---------------------- |
| `discovering` | `Looking for media files in <root path>…`               | Indeterminate (marquee)         | `812 found`            |
| `probing`     | `Probing media files…`, then `Last probed: <file name>` | Determinate: settled/discovered | `1,204 of 3,880 files` |
| `committing`  | `Saving to the catalog…`                                | Indeterminate (marquee)         | `3,880 found`          |

When the scan ends, the dialog changes in place:

| Outcome     | Dialog content                                                                    | Button |
| ----------- | --------------------------------------------------------------------------------- | ------ |
| `completed` | `Scan completed.`, then the discovered, probed, probe-failure, and missing counts | OK     |
| `failed`    | The server's error message, then `The catalog is unchanged.`                      | OK     |
| `cancelled` | `Scan cancelled. The catalog is unchanged.`                                       | OK     |

OK closes the dialog, unlocks the window, and refreshes media roots and the
catalog. The dialog replaces the current **Completed scan** fieldset and the
`Closing this program cancels its scan request` status line.

### Cancelling

**Cancel** asks the server to cancel the scan. It then reads `Cancelling…`
and is disabled until the job reaches a terminal phase. Once the commit has
started, cancelling does nothing and the scan completes normally. The dialog
shows the real outcome either way.

### Closing and reopening

Closing the Media Library window, or the browser, does not cancel the scan.
When the Media Library opens and a root has a running scan, the progress dialog
opens for it. Reattaching happens only while no scan dialog is open, so the
user's own scan never opens twice. If more than one root is scanning (possible with several
clients), the dialog shows the first in media-root order, then the next one
after the user acknowledges it. A scan that finished while no window was
watching does not open a dialog; its **Last scan** time shows that it ran.

### Visual design

- **Progress bar:** a sunken track filled with separated blue blocks, in the
  segmented style of classic Windows progress bars, using the desktop's theme
  tokens. The determinate bar fills block by block. The indeterminate bar runs
  a short group of blocks across the track and back. It is a
  `role="progressbar"` element; the determinate bar sets `aria-valuemin` to 0,
  `aria-valuemax` to `max(discoveredCount, 1)`, and `aria-valuenow` to
  `settledCount`, and the indeterminate bar omits `aria-valuenow`.
- **Animation:** an original inline SVG of a sheet of paper arcing from a
  source folder into a destination folder, looping about every 1.5 seconds
  during `discovering` and `probing`. During `committing` and after the scan
  ends it holds still, as it does under reduced motion. It is decorative (`aria-hidden`). Use
  no Microsoft artwork or animation assets.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, the paper stays
  still beside the destination folder and the indeterminate bar shows a static
  partial fill. Status text and counts still update.
- The status line is a polite live region that announces phase changes only.
  File names and counts render outside it.

## Technical Behavior

### Scan job

A **scan job** is the server's in-memory record of one scan of one media root.
There is at most one non-terminal scan job per root, which matches the
existing `scan_in_progress` rule. The scanner's existing active-scan registry
becomes the job registry. It also keeps each root's latest terminal job until
the next scan of that root or a server restart, so a poll that races
completion still sees the outcome.

Each job has an `id` that is unique within the server process, so a client
can tell its job from a newer scan of the same root.

A job moves through these phases in order. It can end in `failed` from any
non-terminal phase, and in `cancelled` only from `discovering` or `probing`.

```text
discovering -> probing -> committing -> completed
```

A job becomes terminal only after every probe child has closed and, for a
completed commit, `ensureAllEnabled` has returned. The background run never
rejects: every error ends the job in `failed`.

- `discoveredCount` grows during discovery and is final when probing starts.
- `settledCount` counts probes that have settled, whether they succeeded or
  failed. `probeFailedCount` counts the failures.
- `currentPath` is the path of the probe that settled most recently, and it is
  cleared outside `probing`. Probes queue behind the process-wide limit, so the
  scanner knows when one settles but not when one starts.
- `committing` covers the catalog commit and the schedule pass
  (`ensureAllEnabled`) that follows it, so a client that sees `completed` also
  sees the schedules that scan made possible.
- `failed` covers these causes, each with its `error.code`:

  | Cause                                         | `error.code`             |
  | --------------------------------------------- | ------------------------ |
  | Root unavailable during discovery             | `media_root_unavailable` |
  | Root disabled before the commit               | `media_root_disabled`    |
  | Root deleted before the commit                | `media_root_not_found`   |
  | Any unexpected error, logged with the root ID | `scan_failed`            |

Progress counters are plain in-memory fields updated as stages advance. Reading
them does not touch the database or the filesystem.

### Cancellation

- `DELETE` cancels a job in `discovering` or `probing`. Cancellation behaves as
  it does today: active probes terminate, their children close, and nothing
  commits.
- A job in `committing` ignores cancellation and finishes.
- Server shutdown cancels every running job and waits for it to settle before
  the database closes, as `CatalogScanner.shutdown()` does today.
- Client disconnects no longer cancel scans.

### API

```text
POST   /media-roots/:id/scan   start a scan job
GET    /media-roots/:id/scan   read the root's current or latest scan job
DELETE /media-roots/:id/scan   request cancellation
```

`POST`:

| Condition                  | Response                                       |
| -------------------------- | ---------------------------------------------- |
| Scan job started           | `202` with the scan status                     |
| Root not found             | `404` (existing `media_root_not_found`)        |
| Root disabled              | `409` `media_root_disabled`, nothing traversed |
| Root already being scanned | `409` `scan_in_progress`                       |
| Server shutting down       | `503` `scan_cancelled`                         |

An unavailable root is no longer known when `POST` returns. It surfaces as a
`failed` job with code `media_root_unavailable`.

`GET` returns `200` with the root's scan status when the scanner holds a job
for that root. Otherwise it looks the root up and returns `404` with code
`media_root_not_found` when the root does not exist, or `scan_not_found` when
the root has had no scan since the server started.

`DELETE` returns `202` with the scan status. It requests cancellation only for
a job in `discovering` or `probing`; for a job in `committing` or a terminal
phase it returns the status unchanged. It returns the same 404s as `GET` when
there is no job.

Each media root in `GET /media-roots` gains `scan`: its current or latest scan
status, or `null`. The Media Library uses it to find running scans when it
opens.

Scan status shape, with timestamps as ISO 8601 strings like the other API
timestamps:

```ts
interface ScanStatus {
  id: string;
  rootId: string;
  phase:
    | "discovering"
    | "probing"
    | "committing"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  settledCount: number;
  probeFailedCount: number;
  currentPath: string | null;
  cancelRequested: boolean;
  /** Non-null only when phase is `completed`; today's scan summary. */
  summary: ScanSummary | null;
  /** Non-null only when phase is `failed`. */
  error: { code: string; message: string } | null;
}
```

### Polling

- The Media Library polls `GET /media-roots/:id/scan` about once a second
  while its progress dialog shows a non-terminal job and its window is
  visible. Polling stops on a terminal phase.
- A `404` (`scan_not_found` or `media_root_not_found`) means the server no
  longer holds the job, for example after a restart. Polling stops and the
  dialog shows `This scan is no longer running on the server. The catalog may
be unchanged; scan again.` with OK.
- A status whose `id` differs from the job the dialog follows means a newer
  scan replaced it. Polling stops and the dialog shows `A newer scan of this
media root replaced this one.` with OK.
- Any other failed poll keeps the last known status visible and retries on the
  next tick. It never closes the dialog or claims the scan ended.
- Scan requests use the standard request timeout. The one-hour exception for
  scan requests in `apps/web/src/http/api-client.ts` is removed.

### Commit and the event loop

- The writer replaces per-item inserts and updates with multi-row statements,
  chunked within SQLite's parameter limit (`parameterChunks` already exists).
- Between chunks the writer yields a macrotask, such as `setImmediate`, so
  timers and socket I/O, including channel stream fan-out, run during a long
  commit. The commit is still one transaction and stays atomic.
- Other database reads and writes wait for the transaction, as they do today.

## Data Model Impact

None. Scan jobs live only in memory. `media_roots.last_scanned_at` and
`media_items` change exactly as they do today.

## Architecture Boundaries

- Scan jobs belong to `apps/server/src/catalog-scan/`. Routes map job states
  to HTTP; the scanner owns the job registry and progress; the writer remains
  the only component with database access.
- Progress reporting must not change stage order or commit semantics. The
  scanner records progress without the media package knowing about jobs; if a
  stage needs a callback, pass a narrow one through stage options.
- The web client derives every dialog state from the server's scan status. The
  dialog's open state and acknowledged results are transient desktop shell
  state and never decide scan behavior.
- The progress dialog reuses `WindowDialog` with `busy` set while the job is
  non-terminal. Extend `WindowDialog` only if a requirement here cannot be met
  through its existing props.

### kraziTV check

| Area              | Affected? | Notes                                                                                   |
| ----------------- | --------- | --------------------------------------------------------------------------------------- |
| Schedule          | Indirect  | Unchanged `ensureAllEnabled` after a completed commit, now inside the job               |
| Playout timeline  | No        |                                                                                         |
| Channel state     | No        |                                                                                         |
| kraziBrain        | No        |                                                                                         |
| SignalPackager    | No        | Yielding during commit protects broadcast signal pacing; no SignalPackager code changes |
| Provider adapters | No        |                                                                                         |

## Open Questions

- Resolved on 2026-10-07: the batched commit keeps the existing 1,000-row
  chunk (14 columns, so 14,000 bound parameters per statement, under SQLite's
  32,766). How long does the batched commit hold the event loop per chunk, and
  how long does the whole commit take? Commit cost depends on candidates
  written and rows already present, not files on disk, so it was measured with
  synthetic candidates (one in ten a probe failure) as a first scan (all
  inserts) and a rescan (all conflicts), on a file-backed WAL database through
  the real `CatalogScanWriter`, Windows 11 and Node 22.12, after a warm-up,
  over two or three repetitions. Times are milliseconds; ranges span the
  repetitions.

  | Candidates | Scenario | Chunk rows | Chunk hold, median | Chunk hold, max | Total commit |
  | ---------- | -------- | ---------- | ------------------ | --------------- | ------------ |
  | 10,000     | First    | 250        | 2.5-4.6            | 4.2-7.9         | 143-280      |
  | 10,000     | First    | 500        | 4.8-6.2            | 6.6-8.3         | 137-176      |
  | 10,000     | First    | 1,000      | 10.0-10.9          | 10.9-13.9       | 138-156      |
  | 10,000     | First    | 2,000      | 16.8-21.8          | 16.9-25.4       | 116-154      |
  | 10,000     | Rescan   | 250        | 2.1-3.2            | 3.7-5.3         | 157-224      |
  | 10,000     | Rescan   | 500        | 5.3-6.3            | 7.6-9.6         | 189-211      |
  | 10,000     | Rescan   | 1,000      | 9.9-11.7           | 10.8-15.9       | 170-214      |
  | 10,000     | Rescan   | 2,000      | 16.2-24.1          | 19.4-27.0       | 139-211      |
  | 20,000     | First    | 1,000      | 9.9-12.3           | 12.1-18.1       | 316-404      |
  | 20,000     | Rescan   | 1,000      | 8.5-10.8           | 11.1-17.7       | 265-336      |

  The hold per chunk grows linearly with chunk size, while the total commit
  time barely changes with it. The longest single holds are not chunks, and
  chunk size cannot split them: the final `COMMIT` (8-36 ms at 10,000
  candidates, 10-88 ms at 20,000, longest after a first scan) and, on a rescan,
  the read of the root's existing rows (10-19 ms at 10,000, 18-26 ms at
  20,000). At 1,000 rows a chunk holds the loop for about 10-16 ms, below those
  holds, so smaller chunks would add statements without lowering the longest
  hold. The writer yields before each chunk, so the existing-row read and the
  first chunk hold the loop separately. Every other database read, including
  playout reads at program boundaries, still waits for the whole commit,
  which took 140-215 ms at 10,000 candidates and 265-405 ms at 20,000.

## Acceptance Criteria

Server:

- `POST /media-roots/:id/scan` returns `202` with a `discovering` scan status
  before discovery finishes.
- A second `POST` for a root with a running job returns `409`
  `scan_in_progress`, and the existing job continues unaffected.
- A `POST` for a disabled root returns `409` `media_root_disabled` and does
  not traverse the filesystem.
- `GET` reports phases in order, a growing `discoveredCount` during discovery,
  and `settledCount` and `probeFailedCount` that reach their final values
  before `committing`.
- A completed job's `summary` matches the counts today's synchronous scan
  returns for the same root.
- An unavailable root ends in `failed` with code `media_root_unavailable`, and
  the catalog and `lastScannedAt` are unchanged.
- Closing the client connection that started a scan does not cancel it.
- `DELETE` during `discovering` or `probing` ends the job in `cancelled` after
  every probe child has closed, with nothing committed.
- `DELETE` during `committing` leaves the job to complete.
- Server shutdown cancels running jobs and waits for them to settle.
- The latest terminal job stays readable until the next scan of that root.
- `GET /media-roots` includes each root's `scan` status or `null`.
- The commit yields to the event loop between chunks: a `setImmediate`
  callback queued after the first chunk's statement runs before the last
  chunk's statement executes, and the commit stays atomic when it fails
  partway.
- An unexpected error during a job ends it in `failed` with `scan_failed`;
  it never surfaces as an unhandled rejection.
- The probe concurrency limit still applies across concurrent jobs.

Web:

- Selecting **Scan** opens the progress dialog; the Media Library content is
  inert while other windows and the taskbar stay usable.
- The dialog cannot be closed by its title bar or Escape while the job is
  non-terminal.
- The bar is indeterminate during `discovering` and `committing` and
  determinate with correct ARIA values during `probing`.
- **Cancel** sends the request and shows `Cancelling…` until a terminal phase.
- Each terminal outcome shows its content with an OK button that closes the
  dialog and refreshes roots and catalog.
- Reopening the Media Library during a running scan reattaches the dialog.
- A `409` `scan_in_progress` response attaches to the existing scan.
- A failed poll keeps the dialog open with the last known status.
- A `404` poll, or a status for a different job `id`, ends the dialog with its
  message and OK instead of polling forever.
- Starting a scan never shows a generic success message or a
  `scan_in_progress` error.
- Under reduced motion, the dialog shows no animation.

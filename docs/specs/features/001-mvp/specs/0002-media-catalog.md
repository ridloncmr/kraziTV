# Local Media Catalog

Status: Accepted

This spec defines the vertical slice that lets kraziTV discover local media files, normalize basic metadata, and make that catalog available to later channel and scheduling work.

## Problem

kraziTV cannot create useful schedules until it has a stable inventory of playable media. Local files need to be discovered, probed, normalized, and persisted before channels can select them.

The catalog must describe media well enough for scheduling without leaking FFmpeg details, filesystem traversal behavior, or provider-specific metadata into kraziBrain.

## Goals

- Let a user register one or more local media roots.
- Scan supported media files under configured roots.
- Use ffprobe through `packages/media` to capture duration and basic stream metadata.
- Persist discovered media records in SQLite.
- Expose API endpoints for listing media roots and cataloged media items.
- Keep media probing separate from scheduling and provider adapters.
- Make rescans deterministic enough that the same file maps to the same media record unless its identity changes.
- Reproduce the same logical database schema from committed migrations in each
  development environment without copying a generated database file.
- Preserve an explicit post-probe composition seam for later metadata
  enrichment and other normalized catalog processing.

## Non-Goals

- Do not create channels.
- Do not generate schedules.
- Do not decide playback order.
- Do not stream files.
- Do not transcode or package MPEG-TS output.
- Do not connect to Plex or Jellyfin.
- Do not implement advanced tagging, theme rules, seasonal metadata, or AI classification.
- Do not require perfect TV/movie episode parsing in the first pass.
- Do not synchronize or source-control live SQLite database files between
  environments. Cross-machine configuration or catalog transfer requires a
  future explicit export/import contract because catalog paths are
  environment-specific.

## User-Facing Behavior

A user can configure a local media root by providing a filesystem path.

Example media root:

```text
/mnt/media/TV
```

After creating a media root, the user can trigger a scan. kraziTV walks the root, finds supported media files, probes each file, and stores catalog entries.

The user can list cataloged media and see at least:

- File path
- Display title
- Duration
- Catalog status
- Last probed time

The user can also see when each media root was last scanned. After triggering a scan, the user receives a summary of that scan.

If a file cannot be probed, the catalog should preserve enough error state for the user to understand that the file was discovered but is not currently usable for scheduling.

## Technical Behavior

### Media Roots

- A media root represents a local directory that kraziTV is allowed to scan.
- Media roots are persisted.
- A media root has a stable identifier, filesystem path, enabled flag, and timestamps.
- Root paths are immutable after creation. Changing a path requires creating a new media root so catalog identity does not silently change.
- Two media roots cannot use the same normalized absolute path.
- Path identity uses lexical normalization rather than filesystem canonicalization.
  It resolves and normalizes an absolute path without calling `realpath`, so a
  missing, offline, or inaccessible root can still be registered. Identity is
  case-insensitive on Windows and case-sensitive on POSIX platforms.
- Disabled roots are ignored by scans but remain configured.
- Missing or inaccessible roots should not prevent the API server from starting.
- A root path must be absolute, but it may be outside the project directory when the server process can access it.
- Creating a root does not require the path to exist or be readable. A scan is
  the operation that reports whether the configured root is currently accessible.

### File Discovery

- Scans recurse through enabled media roots.
- Scans skip hidden files and directories and only consider files with a supported extension. For the MVP, hidden means that a path segment's basename begins with `.`; platform-specific hidden attributes are deferred.
- Scans do not follow directory symlinks in the first implementation.
- Supported extensions should initially include common video containers such as `.mkv`, `.mp4`, `.m4v`, `.avi`, `.mov`, `.ts`, and `.webm`.
- File discovery should produce normalized absolute paths.
- Discovery returns paths in deterministic normalized-path order.
- A media item's initial identity is the pair `(mediaRootId, normalized absolute path)`. The same path rediscovered under the same root updates the existing record.
- Overlapping roots may catalog the same file as separate media items. Deduplication across roots is deferred.
- The first implementation derives the display title from the filename and defers show, season, and episode inference.

### Media Probing

- `packages/media` owns ffprobe invocation and parsing.
- `packages/media` returns normalized media metadata to the server.
- Callers should not depend on raw ffprobe JSON.
- ffprobe failures should be captured as catalog errors instead of crashing the full scan.
- The first slice requires duration as a positive integer number of milliseconds
  and `hasAudio` as a boolean derived from the probed stream list.
- ffprobe's fractional-second duration is converted once to the nearest whole
  millisecond; subsequent catalog and scheduling code does not use floating-point
  seconds.
- Optional metadata can include container format, video codec, audio codec,
  resolution, and frame rate when available. `hasAudio` is required even when
  detailed audio codec metadata is not retained.

ffprobe must be spawned directly with a structured argument array and
`shell: false`. The executable defaults to `ffprobe` on `PATH` and can be
overridden with `FFPROBE_PATH`. Probe output uses ffprobe's JSON writer with
explicitly selected fields; callers must not parse human-oriented console output.

Each file probe has a timeout, defaulting to 30 seconds and configurable with the
positive integer `FFPROBE_TIMEOUT_MS`. On timeout or cancellation, the wrapper
terminates the child, escalates termination if it has not exited within a 5-second
grace period, and waits for process closure before settling. Timeout failures are
stored as `probe_failed` with a distinguishable error code or message so the scan
can continue.

Probe capture is limited to 1 MiB of stdout and the latest 64 KiB of stderr.
Exceeding the stdout limit terminates the probe and records a failure rather than
allowing a child process to grow server memory without bound.

### Catalog Processing Composition

The server composes catalog processing as explicit operations in this order:

```text
discover -> probe -> future enrichment -> validate candidate -> persist
```

Discovery and probing return normalized, persistence-free values. After probing,
the scanner constructs a normalized catalog candidate that can pass through one
or more explicitly wired enrichment operations before final validation. The
scanner owns this composition; neither `packages/media` capability nor an
enrichment operation writes to SQLite. Raw ffprobe JSON is not a stage contract.

This boundary must allow a later metadata-enrichment operation to consume
normalized discovery and probe results before persistence without changing the
discovery or probe contracts. The MVP does not implement metadata enrichment, a
generic workflow engine, dynamic stage registration, or a plugin system.

Cancellation propagates through each active operation. Concurrent work may
complete out of order, but the scanner restores deterministic path-identity
order before validation and persistence. A future enrichment feature must define
whether each of its failures is item-level, optional, or fatal to the complete
scan.

### Probe Concurrency

A scan probes files through a bounded worker pool rather than starting one child
process per discovered file. The default concurrency is 4 and can be configured
with the positive integer `FFPROBE_CONCURRENCY`. A worker slot remains occupied
until its child has closed, including timeout cleanup. Configuration accepts only
integer values from 1 through 32.

The concurrency limit applies across all scans in the server process. Scans for
different roots may run concurrently through that shared limit. A second scan
for a root that is already being scanned is rejected with a conflict response
and code `scan_in_progress`.

### API

The API should expose endpoints equivalent to:

```text
GET /media-roots
POST /media-roots
PATCH /media-roots/:id
POST /media-roots/:id/scan
GET /media-items
GET /media-items/:id
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

`PATCH /media-roots/:id` must support changing the root's `enabled` flag.

Requesting a scan for a disabled root returns a conflict response and does not traverse the filesystem.

Scan triggering is synchronous for the first implementation. A successful response includes the root ID, start and completion times, and counts for files discovered, successfully probed, probe failures, and items marked missing. A persistent scan-job model can be added later if scans become slow.

The server cancels a synchronous scan if its requesting client disconnects or
the server begins shutdown. Cancellation terminates active probes, waits for
their child processes to close, and does not commit staged catalog changes or
missing reconciliation.

### Persistence

- SQLite stores media roots and media items.
- The database lives under the local runtime data directory.
- Catalog data should survive API restarts.
- Committed, ordered migrations are the source of truth for the logical schema.
  A clean environment uses the same migration entry point as production startup
  and tests to construct that schema without copying an existing database file.
- Migrations are independent of machine-specific paths, catalog contents, and
  wall-clock state. Deterministic development/test fixtures use stable values
  and remain separate from production migrations.
- The generated SQLite file and scanned catalog are machine-local derived state.
  Reproducibility means equivalent schema and fixture behavior, not
  byte-identical database files.
- Removing a file from disk should mark the media item `missing` on the next completed scan, not immediately delete its history.
- Missing-state reconciliation happens only after the scanner completes traversal of an accessible root. A failed scan preserves existing item statuses and does not update `lastScannedAt`.
- An unreadable nested directory or other traversal error fails the complete
  root scan. The scanner must not skip the failed subtree and then reconcile
  unseen items as missing.
- Discovery and probe results are staged before one final persistence
  transaction applies item upserts, missing reconciliation, and
  `lastScannedAt`. A cancelled or otherwise failed scan does not commit a
  partial catalog update.

## Data Model Impact

Minimum media root fields:

```text
MediaRoot
id
path
enabled
createdAt
updatedAt
lastScannedAt
```

Minimum media item fields:

```text
MediaItem
id
mediaRootId
path
title
durationMs
hasAudio
status
probeError
createdAt
updatedAt
lastSeenAt
lastProbedAt
```

Initial media item statuses:

- `available`
- `missing`
- `probe_failed`

Status invariants:

- `available` requires a positive integer `durationMs`, a boolean `hasAudio`,
  and a null `probeError`.
- `probe_failed` requires a non-empty `probeError`. A newly discovered item
  whose first probe fails has null probe metadata. If an item was successfully
  probed previously, a later failure retains that last known metadata for
  diagnostic history, but its status remains authoritative and it is not
  schedulable.
- `missing` preserves previously probed metadata for history, but the item is not schedulable.
- `lastSeenAt` changes when a scan discovers the path. `lastProbedAt` changes only when ffprobe is invoked.

Future specs may add richer media typing, episode fields, provider mappings, user tags, artwork, and collections.

Media roots are filesystem discovery boundaries, not programming rules. Channel programming should use media collections from the channel configuration slice rather than pointing channels directly at root paths.

## Architecture Boundaries

- `packages/media` owns filesystem/media probing helpers and ffprobe normalization.
- `apps/server` owns API routes, explicit scan-stage composition, final catalog
  candidate validation, and persistence wiring.
- `packages/core` may define shared media-facing domain types only if they are scheduling concepts, not raw probe results.
- kraziBrain may later consume normalized catalog records, but it must not perform discovery or invoke ffprobe.
- SignalPackager and provider adapters do not participate in catalog discovery or decide which files belong in the catalog.

## Acceptance Criteria

- A media root can be created with a local filesystem path.
- Duplicate normalized media-root paths are rejected.
- A missing or inaccessible absolute path can be registered as a media root.
- A media root can be enabled or disabled after creation.
- Configured media roots can be listed after API restart.
- A clean environment reproduces the same logical catalog schema from committed
  migrations without copying a generated SQLite file.
- Production migrations do not install development fixtures or depend on
  machine-specific data.
- A scan discovers supported media files under an enabled root.
- A scan request for a disabled root is rejected without traversing it.
- A completed scan returns discovery, probe, failure, and missing-item counts.
- Each discovered playable file is probed with ffprobe through `packages/media`.
- Discovery and probing remain persistence-free operations composed by the
  scanner, which persists only final staged catalog candidates.
- Probe results form a normalized boundary where later enrichment can be
  inserted before persistence without exposing raw ffprobe JSON.
- Successfully probed files are stored as media items with integer millisecond
  durations and an explicit audio-presence flag.
- Probe failures are stored without crashing the entire scan.
- ffprobe uses structured arguments, honors `FFPROBE_PATH`, and never invokes a
  shell.
- Every probe has bounded runtime and output capture, and timed-out children are
  terminated before their worker slot is reused.
- Scans enforce the configured probe concurrency limit.
- The probe concurrency limit is enforced across concurrent scans, and a second
  concurrent scan of the same root is rejected.
- Missing files are marked `missing` on a later scan.
- A failed or inaccessible-root scan does not mark previously cataloged items `missing`.
- An unreadable nested directory fails the scan without committing partial
  catalog changes or updating `lastScannedAt`.
- Client-disconnected and server-shutdown cancellations terminate active probes
  and do not commit staged scan results.
- Cataloged media items can be listed through the API.
- The API server can start even when a configured media root is missing or inaccessible.
- No Plex, Jellyfin, schedule generation, playout timeline generation, or FFmpeg streaming is required for this slice.

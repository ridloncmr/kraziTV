# Local Media Catalog

Status: Draft

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

## Non-Goals

- Do not create channels.
- Do not generate schedules.
- Do not decide playback order.
- Do not stream files.
- Do not transcode or package MPEG-TS output.
- Do not connect to Plex or Jellyfin.
- Do not implement advanced tagging, theme rules, seasonal metadata, or AI classification.
- Do not require perfect TV/movie episode parsing in the first pass.

## User-Facing Behavior

A user can configure a local media root by providing a filesystem path.

Example media root:

```text
/mnt/media/TV
```

After creating a media root, the user can trigger a scan. kraziTV walks the root, finds supported media files, probes each file, and stores catalog entries.

The user can list cataloged media and see at least:

- File path
- Display title or filename-derived title
- Duration
- Scan status
- Last scanned time

If a file cannot be probed, the catalog should preserve enough error state for the user to understand that the file was discovered but is not currently usable for scheduling.

## Technical Behavior

### Media Roots

- A media root represents a local directory that kraziTV is allowed to scan.
- Media roots are persisted.
- A media root has a stable identifier, filesystem path, enabled flag, and timestamps.
- Disabled roots are ignored by scans but remain configured.
- Missing or inaccessible roots should not prevent the API server from starting.

### File Discovery

- Scans recurse through enabled media roots.
- Scans should ignore hidden files and common non-media sidecar files.
- Supported extensions should initially include common video containers such as `.mkv`, `.mp4`, `.m4v`, `.avi`, `.mov`, `.ts`, and `.webm`.
- File discovery should produce normalized absolute paths.
- File identity should be stable across scans. The initial identity can be the normalized absolute path, with room to improve later using file size, modified time, or content hashes.

### Media Probing

- `packages/media` owns ffprobe invocation and parsing.
- `packages/media` returns normalized media metadata to the server.
- Callers should not depend on raw ffprobe JSON.
- ffprobe failures should be captured as catalog errors instead of crashing the full scan.
- The first slice requires duration in seconds.
- Optional metadata can include container format, video codec, audio codec, resolution, and frame rate when available.

### API

The API should expose endpoints equivalent to:

```text
GET /media-roots
POST /media-roots
POST /media-roots/:id/scan
GET /media-items
GET /media-items/:id
```

Exact route names can change during implementation, but the capabilities should remain equivalent.

Scan triggering can be synchronous for the first implementation if the API returns enough status to debug failures. A background job model can be added later if scans become slow.

### Persistence

- SQLite stores media roots and media items.
- The database lives under the local runtime data directory.
- Catalog data should survive API restarts.
- Removing a file from disk should mark the media item unavailable or missing on the next scan, not immediately delete its history.

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
durationSeconds
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

Future specs may add richer media typing, episode fields, provider mappings, user tags, artwork, and collections.

## Architecture Boundaries

This slice affects:

- Schedule: not directly, but it provides the media inputs schedules will later consume.
- Playout timeline: not directly.
- Channel state: not directly.
- kraziBrain: only through future consumption of normalized catalog records.
- SignalPackager: not directly.
- Provider adapters: not directly.

Important boundaries:

- `packages/media` owns filesystem/media probing helpers and ffprobe normalization.
- `apps/server` owns API routes, scan orchestration, and persistence wiring.
- `packages/core` may define shared media-facing domain types only if they are scheduling concepts, not raw probe results.
- kraziBrain must not shell out to ffprobe.
- SignalPackager must not decide which files belong in the catalog.
- Plex/Jellyfin provider adapters must not be required for local catalog scans.

## Open Questions

- Should media root paths be allowed outside the project directory by default?
- Should scans follow symlinks?
- Should the first scanner infer show, season, and episode from paths, or defer that to a later metadata spec?
- Should scan status be represented as a persistent scan job table in the first implementation?
- Should duplicate files across roots be allowed, merged, or flagged?

## Acceptance Criteria

- A media root can be created with a local filesystem path.
- Configured media roots can be listed after API restart.
- A scan discovers supported media files under an enabled root.
- Each discovered playable file is probed with ffprobe through `packages/media`.
- Successfully probed files are stored as media items with duration in seconds.
- Probe failures are stored without crashing the entire scan.
- Missing files are marked `missing` on a later scan.
- Cataloged media items can be listed through the API.
- The API server can start even when a configured media root is missing or inaccessible.
- No Plex, Jellyfin, schedule generation, playout timeline generation, or FFmpeg streaming is required for this slice.

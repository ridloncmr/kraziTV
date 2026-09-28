# SignalPackager MVP

Status: Accepted

This spec defines the MVP SignalPackager behavior: converting selected playout media and offsets into a continuous MPEG-TS stream using FFmpeg without making programming decisions.

## Problem

kraziTV needs to serve a continuous-looking Live TV stream once kraziBrain has decided what should be playing. The media packaging layer must turn local files into provider-consumable stream output, but it must not decide which program belongs on a channel or why it was selected.

The MVP should prove the simplest useful streaming path: join the current program at a calculated offset, continue across at least one program boundary, and produce MPEG-TS output suitable for Plex to consume later.

## Goals

- Accept a provider-neutral playout request from channel state.
- Start FFmpeg for a selected local media file.
- Seek to the requested offset when joining a program in progress.
- Continue a connected stream when the current playout item ends and the next scheduled item begins.
- Produce MPEG-TS output over HTTP.
- Keep FFmpeg command construction out of kraziBrain.
- Keep programming and schedule decisions out of SignalPackager.
- Report packaging failures clearly enough for API logs and debugging.
- Provide a stream contract future provider adapters can point at.

## Non-Goals

- Do not choose what media should play.
- Do not generate schedules.
- Do not generate playout timelines.
- Do not expose Plex XMLTV or M3U endpoints.
- Do not implement commercials, bumpers, station IDs, or filler insertion.
- Do not implement advanced transcoding profiles.
- Do not implement adaptive bitrate streaming, HLS, DASH, or DVR features.
- Do not guarantee frame-perfect joins in the MVP.

## User-Facing Behavior

When a channel has a current playout item, a stream client can request that channel's stream URL and receive MPEG-TS output starting near the current broadcast position.

Example flow:

```text
1. kraziBrain resolves current playout item.
2. Current item points to /mnt/media/TV/Show A/S01E02.mkv.
3. Current offset is 555 seconds.
4. SignalPackager starts FFmpeg with that file and offset.
5. Client receives MPEG-TS bytes over HTTP.
6. When Show A ends, the stream transitions to the next playout item without requiring the client to retune.
```

If the media file is missing, unreadable, or FFmpeg exits early, the stream request should fail with a clear error and log context. Future filler behavior can replace failures later.

## Technical Behavior

### Input Contract

SignalPackager receives an explicit packaging request.

Minimum request fields:

```text
PackageStreamRequest
channelId
initialPlayoutItemId
items[]
  playoutItemId
  mediaItemId
  mediaPath
  offsetSeconds
  durationSeconds
contentType
```

The request is produced by API/channel-state code after kraziBrain resolves the current playout item and enough following playout items to keep the stream alive across at least one boundary.

For the MVP, `items[]` is a finite handoff buffer. It is sufficient to prove joining an in-progress item and crossing at least one program boundary, but it is not the permanent abstraction for a forever-running channel. A later stream worker or replenishment contract should be added before kraziTV relies on one HTTP response staying live indefinitely. That future contract must still receive selected playout items from channel state or kraziBrain-owned scheduling code; SignalPackager must not query scheduling state directly.

SignalPackager must not query channel rules, choose media, advance schedules, or modify playback history.

### Output Contract

SignalPackager produces an HTTP response stream.

MVP output format:

```text
video/MP2T
```

The stream should be consumable by clients that expect MPEG-TS over HTTP.

### FFmpeg Behavior

SignalPackager owns FFmpeg process construction and lifecycle.

The MVP should support:

- Input file path
- Seek offset
- MPEG-TS output to stdout
- Process stderr capture for logs
- Process cleanup when the HTTP client disconnects
- Non-zero exit handling
- Transitioning from the current item to at least the next item in one logical HTTP stream

The MVP transcodes every program into one compatibility profile. Stream copy is deferred so media transitions do not depend on source codec compatibility.

Initial compatibility profile:

```text
Video: H.264, yuv420p, 1920x1080, 30 fps
Audio: AAC, 48 kHz, stereo
Container: MPEG-TS
Content type: video/MP2T
```

Video preserves source aspect ratio and is scaled and padded to the target frame without cropping.

The command must be constructed from structured arguments, not shell string concatenation.

The compatibility spike determines whether independent FFmpeg processes can cross a file boundary reliably in Plex. The formal implementation must use the simplest verified strategy, whether sequential processes or a concat-oriented FFmpeg graph. Callers see one continuous response stream either way.

If sequential FFmpeg processes are used, Plex compatibility must be verified with a real two-file boundary, not only by checking that the HTTP connection remains open. The compatibility spike should confirm that Plex continues playback across the boundary despite any MPEG-TS timestamp, PCR, or continuity-counter discontinuities caused by independent encoder runs.

### Stream Endpoint

The API should expose an endpoint equivalent to:

```text
GET /channels/:id/stream
```

Exact route names can change during implementation, but the capability should remain equivalent.

The stream endpoint should:

- Resolve current channel state.
- Build a packaging request from the current playout item plus following playout items.
- Delegate media packaging to SignalPackager.
- Return MPEG-TS output.
- Stop FFmpeg when the client disconnects.

The provider-neutral endpoint is registered by `apps/server`; provider adapters link to it rather than owning a separate packaging route.

### Error Handling

Failure cases should include:

- Channel not found
- Channel disabled
- No current playout item
- Missing media path
- Invalid offset
- FFmpeg not found
- FFmpeg startup failure
- FFmpeg exits before producing usable output

Errors should be logged with channel ID, media item ID, media path when safe, offset, and FFmpeg exit information when available. Before response bytes begin, failures return a structured HTTP error. After streaming begins, failures are logged and the response terminates; the MVP does not synthesize an error or filler stream.

### Resource Management

- One stream request may start one FFmpeg process.
- If a stream crosses a program boundary, one request may start more than one FFmpeg process over its lifetime.
- FFmpeg processes must be terminated when clients disconnect.
- Each viewer request owns its FFmpeg process or process sequence. Shared stream fan-out is deferred.
- Later implementations may add process reuse, buffering, or per-channel stream workers.

The FFmpeg executable defaults to `ffmpeg` on `PATH` and can be overridden with the `FFMPEG_PATH` environment variable.

## Data Model Impact

This slice does not require persistent domain data.

Optional operational logging may record stream attempts, failures, or FFmpeg exit codes, but that is not required for MVP correctness.

Future packaging profiles may introduce persistent configuration, but the MVP should avoid profile tables until a concrete need exists.

## Architecture Boundaries

This slice affects:

- Schedule: not directly.
- Playout timeline: indirectly, by consuming selected current playout items.
- Channel state: indirectly, by using current item and offset.
- kraziBrain: not directly; it must not construct FFmpeg commands.
- SignalPackager: directly.
- Provider adapters: indirectly, by giving them a stream URL target.

Important boundaries:

- SignalPackager accepts selected media and offset; it does not decide what should be playing.
- SignalPackager owns FFmpeg command construction.
- kraziBrain owns playout decisions and current offset calculation.
- Provider adapters expose stream URLs later; they do not construct FFmpeg commands.
- `apps/server` owns HTTP routing and request lifecycle wiring.
- `packages/signal` owns FFmpeg lifecycle, transcoding, muxing, stream continuity, seeking, packaging, and encoding-profile code.
- `packages/media` owns media discovery, filesystem inspection, ffprobe, and source metadata. It must not grow stream packaging responsibilities.

## Compatibility Spike Output

The Plex spike must record the verified FFmpeg arguments and whether sequential encoders preserve playback across the two-file boundary. Those empirical values may refine the fixed profile without changing the provider-neutral packaging contract.

## Deferred Work

- Stream-copy optimization for compatible sources.
- Shared per-channel workers and multi-viewer fan-out.
- A replenishable queue for indefinitely long responses beyond the MVP boundary proof.
- Filler streams for failures after response bytes begin.

## Acceptance Criteria

- A stream request for an enabled channel with a current playout item starts FFmpeg for the selected media file.
- FFmpeg receives the current offset calculated outside SignalPackager.
- The HTTP response uses MPEG-TS output.
- Every item is transcoded to the fixed MVP compatibility profile.
- A viewer connected to a channel stream remains connected when the current playout item ends and the next scheduled item begins.
- Plex remains playing across an actual two-file boundary during the compatibility spike.
- FFmpeg stderr and exit information are logged for failures.
- FFmpeg is terminated when the HTTP client disconnects.
- Each viewer owns its packaging process sequence; shared fan-out is not required.
- Missing media, invalid offsets, disabled channels, and no-current-item states fail clearly.
- SignalPackager does not choose media, generate schedules, generate playout timelines, or mutate channel state.
- kraziBrain does not construct FFmpeg commands.

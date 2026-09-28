# Plex Adapter MVP

Status: Draft

This spec defines the MVP Plex adapter behavior: exposing kraziTV channels, guide data, and stream URLs in Plex-compatible forms without moving scheduling or media packaging decisions into the adapter.

## Problem

kraziTV's MVP is Plex-first. Plex needs a way to discover channels, read guide data, and tune streams. kraziTV already models these concepts internally as provider-neutral channel configuration, schedule entries, playout state, and stream endpoints. The Plex adapter must translate those concepts into Plex-compatible outputs.

The adapter should be thin. It should expose what kraziTV has decided, not decide what plays, how schedules are generated, or how FFmpeg packages streams.

## Goals

- Expose enabled kraziTV channels to Plex.
- Expose an HDHomeRun-compatible tuner discovery/device API that Plex can add manually.
- Provide a channel lineup with stable channel stream URLs.
- Provide XMLTV-compatible guide data from schedule entries.
- Map provider-neutral channel identity to Plex-facing channel identifiers.
- Point Plex stream URLs at provider-neutral stream endpoints.
- Keep Plex-specific formatting out of kraziBrain.
- Keep FFmpeg command construction out of the Plex adapter.
- Provide enough behavior for Plex Live TV setup and tuning in the MVP.

## Non-Goals

- Do not implement Jellyfin or Emby adapters.
- Do not connect to Plex's private server APIs unless later required.
- Do not generate schedules inside the Plex adapter.
- Do not generate playout timelines inside the Plex adapter.
- Do not construct FFmpeg commands.
- Do not implement Plex account authentication.
- Do not implement advanced guide artwork, ratings, genres, or rich episode metadata.
- Do not implement DVR recording support.

## User-Facing Behavior

A user can configure Plex Live TV with kraziTV as a tuner-like source by pointing Plex at the kraziTV server.

The MVP does not need automatic network discovery. Manual tuner configuration is sufficient if Plex accepts kraziTV's HDHomeRun-compatible endpoints.

Example URLs:

```text
http://127.0.0.1:3000/discover.json
http://127.0.0.1:3000/lineup_status.json
http://127.0.0.1:3000/lineup.json
http://127.0.0.1:3000/device.xml
http://127.0.0.1:3000/plex/xmltv.xml
```

Plex should see enabled kraziTV channels with their channel numbers and display names.

When a user selects a kraziTV channel in Plex, Plex requests the channel stream URL from the tuner lineup. kraziTV subscribes that request to the channel's shared active broadcast through `ChannelStreamManager`. Plex remains unaware of worker lifecycle.

## Technical Behavior

### Channel Exposure

The Plex adapter exposes enabled channels only.

HDHomeRun lineup entries should include at least:

- Channel number
- Channel name
- Stream URL

HDHomeRun `/lineup.json` does not need to expose an arbitrary internal ID field. Stable kraziTV channel IDs should instead back URL paths, XMLTV channel IDs, and any provider mapping needed internally. Those identifiers must be derived from stable channel identity, not mutable display names.

Disabled channels should not appear in the tuner lineup or guide output.

### HDHomeRun-Compatible Tuner API

The Plex adapter should expose endpoints equivalent to:

```text
GET /discover.json
GET /lineup_status.json
GET /lineup.json
GET /device.xml
```

`/lineup.json` should return enabled kraziTV channels in a shape Plex can treat as tuner channels.

Example:

```json
[
  {
    "GuideNumber": "69",
    "GuideName": "Krazi Comedy",
    "URL": "http://127.0.0.1:3000/channels/channel_69/stream"
  }
]
```

`/discover.json`, `/lineup_status.json`, and `/device.xml` should contain stable device identity and status data. Exact fields should be verified during the Plex compatibility spike before the full MVP adapter is implemented.

The tuner output should not embed scheduling decisions or FFmpeg options.

### XMLTV Output

The API should expose an endpoint equivalent to:

```text
GET /plex/xmltv.xml
```

XMLTV output should include:

- Channel declarations for enabled channels
- Display names
- Channel numbers when representable
- Programme entries from kraziTV schedule entries
- Programme start and stop timestamps
- Programme titles

The MVP can use simple titles from schedule entries. Rich metadata such as season, episode, descriptions, ratings, categories, and artwork can be added later.

XMLTV generation reads the available schedule horizon and emits up to 72 hours of future guide data for Plex setup and basic browsing.

### Stream URL Mapping

Stream URLs exposed to Plex should map to existing channel stream behavior. Multiple Plex clients tuning the same channel should subscribe to the same active channel worker and receive the same broadcast signal.

Exact URL shape can change during implementation, but Plex-facing URLs must be stable enough for Plex configuration.

All absolute tuner, lineup, guide, and stream URLs are built from a configured `PUBLIC_BASE_URL`. It defaults to `http://127.0.0.1:3000` for local development. Deployments where Plex runs in another process, container, or host must configure a URL Plex can reach; request `Host` headers are not treated as authoritative public configuration.

### API

The Plex adapter should expose endpoints equivalent to:

```text
GET /discover.json
GET /lineup_status.json
GET /lineup.json
GET /device.xml
GET /plex/xmltv.xml
```

Optional debug endpoints can be added later, but are not required for the MVP.

### Provider Mapping

Provider-specific mapping should be derived, not stored, unless a concrete need appears.

If persistent provider mappings are needed later, they should map provider adapter names and provider IDs to provider-neutral channel IDs without changing core channel identity.

## Data Model Impact

This slice does not require persistent data beyond existing channel and schedule data.

Optional future provider mapping fields could include:

```text
ProviderChannelMapping
provider
providerChannelId
channelId
createdAt
updatedAt
```

Do not add this table for the MVP unless implementation proves it is needed.

## Architecture Boundaries

This slice affects:

- Schedule: indirectly, by reading schedule entries for XMLTV.
- Playout timeline: indirectly, through stream URLs that resolve current playback later.
- Channel state: indirectly, through stream tuning.
- kraziBrain: not directly; it must not emit Plex-specific data.
- SignalPackager: not directly; Plex stream URLs eventually use its output.
- Provider adapters: directly.

Important boundaries:

- Plex adapter maps provider-neutral channels and schedules into Plex-compatible outputs.
- Plex adapter does not decide what plays.
- Plex adapter does not generate schedules or playout timelines.
- Plex adapter does not construct FFmpeg commands.
- `packages/plex` owns Plex-specific formatting helpers.
- `apps/server` owns HTTP route registration and response wiring.
- `packages/core` should remain free of Plex-specific HDHomeRun and XMLTV formatting details.

## Compatibility Spike

Before the full MVP dependency chain is implemented, run a hard-coded Plex tuner compatibility spike.

The spike should implement:

```text
GET /discover.json
GET /lineup_status.json
GET /lineup.json
GET /device.xml
GET /channels/69/stream
```

The spike may hard-code one channel:

```text
69
Krazi Comedy
```

It should hard-code two local media files and serve them sequentially through one stream response so the test crosses a real file boundary. No database, scheduler, Web UI, complete domain model, or reusable adapter implementation is required.

Spike success criteria:

- Plex recognizes kraziTV as a tuner.
- Channel 69 appears in Plex Live TV.
- Viewer A successfully tunes Channel 69.
- ChannelWorker 69 starts.
- Video plays for Viewer A.
- The broadcast advances at approximately 1x wall-clock speed without racing ahead of the scheduled program.
- Viewer B tunes Channel 69 while Viewer A remains connected.
- No second FFmpeg encoder starts.
- Viewer B joins the already-running shared worker successfully.
- Viewer A and Viewer B receive the same broadcast signal.
- Disconnecting Viewer A does not affect Viewer B.
- Plex remains playing for both viewers across an actual two-file stream boundary.
- After the final viewer disconnects, ChannelWorker 69 stops after the idle grace period.
- No FFmpeg process remains for Channel 69.

After the spike succeeds, record the required HDHomeRun response fields, verified FFmpeg pacing arguments, successful stream-boundary strategy, late-join behavior and initialization requirements, subscriber buffering strategy, and Plex behavior when joining an already-running MPEG-TS stream in this spec. Then change the spec status to `Accepted`. The hard-coded spike can be discarded or refactored into the formal MVP adapter.

## Decisions Required From The Spike

- Exact HDHomeRun response fields required for reliable manual tuner setup.
- Any Plex constraints on XMLTV horizon beyond the MVP's 72-hour schedule horizon.
- The verified FFmpeg continuity strategy for a real two-file boundary.
- The verified real-time pacing arguments and a measurable maximum drift across file boundaries.
- The verified late-join strategy for an already-running MPEG-TS worker.
- The subscriber fan-out strategy and concrete byte or duration limits needed to keep slow clients isolated.
- A concrete idle grace duration that avoids encoder churn during Plex reconnects.

## Deferred Work

- Generic M3U output for debugging or non-Plex IPTV clients.
- Automatic network tuner discovery.
- Episode numbering, channel logos, artwork, and richer XMLTV metadata.

## Acceptance Criteria

- Plex accepts kraziTV's HDHomeRun-compatible tuner endpoints during manual Live TV setup.
- Tuner lineup output lists enabled kraziTV channels.
- Disabled channels are omitted from XMLTV output.
- Disabled channels are omitted from HDHomeRun lineup output.
- HDHomeRun lineup entries include channel names, channel numbers, and stream URLs.
- Plex-facing XMLTV identifiers are derived from stable kraziTV channel IDs.
- XMLTV output includes channel declarations and programme entries from schedule data.
- XMLTV programme entries include start time, stop time, channel ID, and title.
- Plex-facing stream URLs delegate to provider-neutral channel stream behavior.
- The shared channel broadcast remains aligned with wall-clock time independently of viewer throughput.
- Multiple Plex viewers on the same channel share one active channel worker and one FFmpeg pipeline.
- A late Plex viewer can join an already-running shared channel worker.
- Plex adapter does not generate schedules, generate playout timelines, choose media, mutate channel state, or construct FFmpeg commands.
- kraziBrain does not emit Plex-specific HDHomeRun or XMLTV formatting.

# Plex Adapter MVP

Status: Accepted

This spec defines the MVP Plex adapter behavior: exposing kraziTV channels, guide data, and stream URLs in Plex-compatible forms without moving scheduling or media packaging decisions into the adapter.

## Problem

kraziTV's MVP is Plex-first. Plex needs a way to discover channels, read guide data, and tune streams. kraziTV already models these concepts internally as provider-neutral channel configuration, schedule entries, playout state, and stream endpoints. The Plex adapter must translate those concepts into Plex-compatible outputs.

The adapter should be thin. It should expose what kraziTV has decided, not decide what plays, how schedules are generated, or how FFmpeg packages streams.

## Goals

- Expose enabled kraziTV channels to Plex.
- Expose an HDHomeRun-compatible tuner discovery/device API that Plex can add manually.
- Provide a channel lineup with stable channel stream URLs.
- Provide XMLTV-compatible guide data from schedule entries.
- Keep a generic M3U playlist available for debugging and future IPTV-style clients.
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

When a user selects a kraziTV channel in Plex, Plex requests the channel stream URL from the tuner lineup. kraziTV resolves the current channel state and delegates MPEG-TS packaging to SignalPackager.

## Technical Behavior

### Channel Exposure

The Plex adapter exposes enabled channels only.

HDHomeRun lineup entries should include at least:

- Channel number
- Channel name
- Stream URL

HDHomeRun `/lineup.json` does not need to expose an arbitrary internal ID field. Stable kraziTV channel IDs should instead back URL paths, XMLTV channel IDs, M3U `tvg-id` values, and any provider mapping needed internally. Those identifiers must be derived from stable channel identity, not mutable display names.

Disabled channels should not appear in the tuner lineup, M3U playlist, or guide output.

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

### M3U Output

The API may also expose an endpoint equivalent to:

```text
GET /channels.m3u
```

The playlist should be valid extended M3U and useful for debugging, Jellyfin exploration, or generic IPTV clients.

Each channel entry should point to the provider-neutral stream endpoint for that channel or to a Plex-namespaced redirect that delegates to the provider-neutral stream endpoint.

The M3U output should not be considered the primary Plex Live TV integration path unless the compatibility spike proves Plex setup requires it.

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

XMLTV generation should request or read schedule entries for a bounded guide window. The first implementation should support enough future guide data for Plex setup and basic browsing.

### Stream URL Mapping

Stream URLs exposed to Plex should map to existing channel stream behavior.

Example:

```text
#EXTINF:-1 tvg-id="channel_69" tvg-chno="69" tvg-name="Krazi Comedy",Krazi Comedy
http://127.0.0.1:3000/channels/channel_69/stream
```

Exact URL shape can change during implementation, but Plex-facing URLs must be stable enough for Plex configuration.

### API

The Plex adapter should expose endpoints equivalent to:

```text
GET /discover.json
GET /lineup_status.json
GET /lineup.json
GET /device.xml
GET /plex/xmltv.xml
GET /channels.m3u
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
- `packages/core` should remain free of Plex-specific HDHomeRun, XMLTV, and M3U formatting details where possible.

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
- Plex successfully tunes Channel 69.
- Video plays.
- Plex remains playing across an actual two-file stream boundary.

After the spike succeeds, the hard-coded implementation can be discarded or refactored into the formal MVP adapter.

## Open Questions

- What exact HDHomeRun fields does Plex require for reliable manual tuner setup?
- How much future XMLTV guide data does Plex expect during setup?
- Should Plex endpoints be configurable by external base URL for Docker or LAN access?
- Should stream URLs be provider-neutral paths or `/plex/...` paths that redirect internally?
- Should XMLTV include minimal episode numbering if inferred metadata exists?
- Should channel logos be deferred or included as optional URLs in the MVP?

## Acceptance Criteria

- Plex accepts kraziTV's HDHomeRun-compatible tuner endpoints during manual Live TV setup.
- Tuner lineup output lists enabled kraziTV channels.
- Disabled channels are omitted from M3U and XMLTV output.
- Disabled channels are omitted from HDHomeRun lineup output.
- HDHomeRun lineup entries include channel names, channel numbers, and stream URLs.
- Plex-facing XMLTV and M3U identifiers are derived from stable kraziTV channel IDs.
- XMLTV output includes channel declarations and programme entries from schedule data.
- XMLTV programme entries include start time, stop time, channel ID, and title.
- Plex-facing stream URLs delegate to provider-neutral channel stream behavior.
- Generic M3U output remains available but is not the primary Plex tuner contract.
- Plex adapter does not generate schedules, generate playout timelines, choose media, mutate channel state, or construct FFmpeg commands.
- kraziBrain does not emit Plex-specific HDHomeRun, XMLTV, or M3U formatting.

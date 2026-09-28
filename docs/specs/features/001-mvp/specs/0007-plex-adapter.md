# Plex Adapter MVP

Status: Draft

This spec defines the MVP Plex adapter behavior: exposing kraziTV channels, guide data, and stream URLs in Plex-compatible forms without moving scheduling or media packaging decisions into the adapter.

## Problem

kraziTV's MVP is Plex-first. Plex needs a way to discover channels, read guide data, and tune streams. kraziTV already models these concepts internally as provider-neutral channel configuration, schedule entries, playout state, and stream endpoints. The Plex adapter must translate those concepts into Plex-compatible outputs.

The adapter should be thin. It should expose what kraziTV has decided, not decide what plays, how schedules are generated, or how FFmpeg packages streams.

## Goals

- Expose enabled kraziTV channels to Plex.
- Provide an M3U-compatible playlist with stable channel stream URLs.
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

A user can configure Plex Live TV with kraziTV as a tuner-like source by using kraziTV-provided playlist and guide URLs.

Example URLs:

```text
http://127.0.0.1:3000/plex/channels.m3u
http://127.0.0.1:3000/plex/xmltv.xml
```

Plex should see enabled kraziTV channels with their channel numbers and display names.

When a user selects a kraziTV channel in Plex, Plex requests the channel stream URL from the playlist. kraziTV resolves the current channel state and delegates MPEG-TS packaging to SignalPackager.

## Technical Behavior

### Channel Exposure

The Plex adapter exposes enabled channels only.

M3U channel entries should include at least:

- Stable channel ID
- Channel number
- Channel name
- Stream URL

The adapter should derive Plex-facing IDs from stable kraziTV channel IDs, not from mutable display names.

Disabled channels should not appear in the Plex playlist or guide output.

### M3U Output

The API should expose an endpoint equivalent to:

```text
GET /plex/channels.m3u
```

The playlist should be valid extended M3U.

Each channel entry should point to the provider-neutral stream endpoint for that channel or to a Plex-namespaced redirect that delegates to the provider-neutral stream endpoint.

The M3U output should not embed scheduling decisions or FFmpeg options.

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
GET /plex/channels.m3u
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
- `packages/core` should remain free of Plex-specific XMLTV/M3U formatting details where possible.

## Open Questions

- What exact M3U attributes does Plex require for reliable channel number and guide matching?
- How much future XMLTV guide data does Plex expect during setup?
- Should Plex endpoints be configurable by external base URL for Docker or LAN access?
- Should stream URLs be provider-neutral paths or `/plex/...` paths that redirect internally?
- Should XMLTV include minimal episode numbering if inferred metadata exists?
- Should channel logos be deferred or included as optional URLs in the MVP?

## Acceptance Criteria

- Plex-compatible M3U output lists enabled kraziTV channels.
- Disabled channels are omitted from M3U and XMLTV output.
- M3U channel entries include stable IDs, channel names, channel numbers, and stream URLs.
- XMLTV output includes channel declarations and programme entries from schedule data.
- XMLTV programme entries include start time, stop time, channel ID, and title.
- Plex-facing stream URLs delegate to provider-neutral channel stream behavior.
- Plex adapter does not generate schedules, generate playout timelines, choose media, mutate channel state, or construct FFmpeg commands.
- kraziBrain does not emit Plex-specific XMLTV or M3U formatting.

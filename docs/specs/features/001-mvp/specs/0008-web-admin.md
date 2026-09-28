# Web Admin MVP

Status: Draft

This spec defines the MVP Web Admin behavior: a minimal browser interface for configuring media roots, media collections, channels, playback mode, and observing generated programming and current channel state.

## Problem

kraziTV needs a usable configuration surface before it can be practical for non-code setup. Users should not need to edit JSON, call APIs manually, or inspect SQLite to create a basic Plex-ready channel.

The Web Admin should make the MVP loop visible and debuggable while keeping scheduling, media probing, playout, provider formatting, and FFmpeg behavior in their owning backend modules.

## Goals

- Provide a minimal browser UI for MVP setup.
- Let users configure local media roots.
- Let users trigger or observe media scans.
- Let users create simple media collections from cataloged media.
- Let users create and edit channels.
- Let users choose chronological or random playback mode.
- Let users view generated schedule entries.
- Let users view current channel state and playback offset.
- Expose Plex tuner and XMLTV setup URLs.
- Expose a generic M3U URL as a secondary/debugging aid.
- Keep domain decisions in backend APIs and core packages.

## Non-Goals

- Do not implement a polished final design system.
- Do not implement user accounts or authentication.
- Do not implement multi-user permissions.
- Do not implement manual schedule editing.
- Do not implement drag-and-drop programming blocks.
- Do not implement commercial, bumper, station ID, or filler configuration.
- Do not implement Jellyfin or Emby setup screens.
- Do not run FFmpeg directly from the browser.

## User-Facing Behavior

The Web Admin should support a basic setup flow:

```text
1. Open kraziTV Web Admin.
2. Add a local media root.
3. Scan the media root.
4. Create a media collection from cataloged items.
5. Create a channel.
6. Select channel number, name, media collection, and playback mode.
7. View upcoming schedule entries.
8. View what is currently playing.
9. Copy Plex tuner and guide URLs.
```

The UI should make empty states clear, especially when:

- No media roots exist.
- A media root has not been scanned.
- A scan found no schedulable media.
- No media collections exist.
- No channels exist.
- A channel has no generated schedule.
- A channel has no current playout item.

## Technical Behavior

### Application Shell

The Web Admin uses React, Vite, and TypeScript.

The MVP UI should include navigation or sections for:

- Overview
- Media roots and catalog
- Media collections
- Channels
- Schedule/current state
- Plex setup

The exact visual layout can change during implementation, but the setup path should remain obvious.

### Media Root UI

The user can:

- List configured media roots.
- Add a media root by path.
- Enable or disable a media root when the API supports it.
- Trigger a scan when the API supports it.
- See scan status or last scanned time.
- See media item counts or basic catalog results.

The UI should display API validation errors directly enough for the user to fix input.

### Media Collection UI

The user can:

- List media collections.
- Create a media collection.
- Add cataloged media items to a collection.
- Remove media items from a collection.
- See whether a collection has schedulable available media.

The UI should present media collections as programming eligibility, not as filesystem locations.

### Channel UI

The user can:

- List channels.
- Create a channel.
- Edit channel number and name.
- Enable or disable a channel.
- Select playback mode.
- Select a media collection.
- Delete a channel when the API supports it.

The UI must not implement scheduling rules locally. It submits channel configuration to the API and renders API responses.

### Schedule And Current State UI

The user can view:

- Upcoming schedule entries for a selected channel.
- Current program for a selected channel.
- Current playback offset when available.
- Next program when available.

The UI can request schedule or current-state data from the API, but it must not calculate authoritative current playback position from local browser time. The backend remains the source of truth.

### Plex Setup UI

The user can view or copy:

- Plex tuner base URL
- Plex XMLTV guide URL
- Generic M3U playlist URL

The UI may include short instructions for using the tuner base URL and XMLTV URL in Plex Live TV setup. M3U should be presented as secondary/debug output rather than the primary Plex setup path.

### API Integration

The Web Admin consumes existing API capabilities from the MVP specs.

Expected API areas:

- Health
- Media roots
- Media items
- Media collections
- Channels
- Schedule
- Current channel state
- Plex endpoints

The UI should handle loading, empty, success, and error states for each API-backed view.

## Data Model Impact

This slice should not add persistent domain data.

The Web Admin may introduce client-side view state, form state, and transient UI preferences. Those should not become authoritative domain state unless a later spec defines persistent UI settings.

## Architecture Boundaries

This slice affects:

- Schedule: indirectly, by displaying schedule entries from the API.
- Playout timeline: indirectly, by displaying current channel state.
- Channel state: indirectly, by displaying backend-computed state.
- kraziBrain: not directly; Web Admin must not make scheduling or playout decisions.
- SignalPackager: not directly; Web Admin must not construct FFmpeg commands.
- Provider adapters: indirectly, by displaying Plex setup URLs.

Important boundaries:

- `apps/web` owns browser UI, form state, and API presentation.
- `apps/server` remains the API authority for persisted configuration and computed state.
- `packages/core` owns domain behavior and deterministic decisions.
- `packages/media` owns probing/catalog behavior exposed through API responses.
- `packages/plex` owns Plex-specific formatting exposed through API URLs.
- The Web Admin must not duplicate scheduling algorithms, playout lookup, HDHomeRun formatting, XMLTV generation, M3U generation, or FFmpeg command construction.

## Open Questions

- Should the MVP Web Admin be served by the Fastify server in production, or remain a separate Vite app until packaging work begins?
- Should API base URL be configured at build time, runtime, or inferred from the browser origin?
- Should the MVP include authentication warnings if the server binds beyond localhost?
- Should scan progress be polled, streamed, or refreshed manually in the first implementation?
- Should current channel state refresh automatically, and if so at what interval?
- Should Plex setup URLs use localhost by default or a configured external base URL?

## Acceptance Criteria

- The Web Admin loads in a browser.
- The UI can show API health or connection status.
- A user can add or view media roots through the UI.
- A user can trigger or observe media scanning when the API supports it.
- A user can create and edit simple media collections through the UI.
- A user can create and edit channels through the UI.
- A user can select chronological or random playback mode through the UI.
- A user can view upcoming schedule entries for a channel.
- A user can view current channel state and offset when available.
- A user can view or copy Plex tuner and XMLTV URLs.
- A user can view or copy a generic M3U URL as a secondary/debugging aid.
- UI behavior does not require Jellyfin, advanced transcoding profiles, commercials, manual schedule editing, or authentication.
- The Web Admin does not implement authoritative scheduling, playout timeline lookup, Plex formatting, or FFmpeg command construction.

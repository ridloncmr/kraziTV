# Web Admin MVP

Status: Accepted

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
- Expose Plex tuner and XMLTV setup URLs after the Plex adapter contract is verified and accepted.
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
9. After the Plex adapter is accepted, copy Plex tuner and guide URLs.
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
- Plex setup, when the Plex adapter is accepted

The exact visual layout can change during implementation, but the setup path should remain obvious.

### Media Root UI

The user can:

- List configured media roots.
- Add a media root by path.
- Enable or disable a media root.
- Trigger a scan.
- See the last scanned time and the result summary returned by a triggered scan.
- See media item counts or basic catalog results.

The UI should display API validation errors directly enough for the user to fix input.

### Media Collection UI

The user can:

- List media collections.
- Create a media collection.
- Add cataloged media items to a collection.
- Remove media items from a collection.
- Reorder collection items to define chronological playback order.
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

If a disable or delete response reports
`channel_runtime_cleanup_failed`, the UI must state that the configuration
change was saved but runtime cleanup did not finish. It offers a retry action for
the same operation and must not present the failure as though the channel were
still enabled or undeleted. A successful retry confirms that cleanup settled;
it does not recreate deleted configuration.

### Schedule And Current State UI

The user can view:

- Upcoming schedule entries for a selected channel.
- Current program for a selected channel.
- Current playback offset when available.
- Next program when available.

The UI can request schedule or current-state data from the API, but it must not calculate authoritative current playback position from local browser time. The backend remains the source of truth.

### Plex Setup UI

This UI is conditional on the Plex compatibility spike and acceptance of the Plex adapter spec. Until then, its response fields and setup URLs are not a stable implementation requirement.

The user can view or copy:

- Plex tuner base URL
- Plex XMLTV guide URL

The UI may include short instructions for using the tuner base URL and XMLTV URL in Plex Live TV setup. The backend supplies these URLs from its configured `PUBLIC_BASE_URL`; the browser must not reconstruct them from its own location.

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
- Plex endpoints, when the Plex adapter is accepted

The UI should handle loading, empty, success, and error states for each API-backed view.

The browser API base URL uses `VITE_API_BASE_URL` when configured. During local development it defaults to `http://127.0.0.1:3000`; production packaging may use same-origin API requests when the variable is absent.

Media scans are synchronous in the MVP. The UI shows a pending state while the request is active and displays the returned summary when it completes. Current channel state refreshes every 10 seconds while its view is visible and also supports manual refresh.

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
- The Web Admin must not duplicate scheduling algorithms, playout lookup, HDHomeRun formatting, XMLTV generation, or FFmpeg command construction.

## Deferred Work

- Decide how the Web Admin is served in production when packaging work begins.
- Add authentication before treating the administration API as safe for untrusted networks.
- Add background scan jobs and progress reporting if synchronous scans prove too slow.

## Acceptance Criteria

- The Web Admin loads in a browser.
- The UI can show API health or connection status.
- A user can add or view media roots through the UI.
- A user can trigger media scanning and see its result summary through the UI.
- A user can create and edit simple media collections through the UI.
- A user can reorder collection items to define chronological playback order.
- A user can create and edit channels through the UI.
- A user can distinguish a validation/persistence failure from a committed
  disable/delete whose runtime cleanup needs retry, and can retry that cleanup.
- A user can select chronological or random playback mode through the UI.
- A user can view upcoming schedule entries for a channel.
- A user can view current channel state and offset when available.
- After the Plex adapter spec is accepted, a user can view or copy Plex tuner and XMLTV URLs.
- UI behavior does not require Jellyfin, advanced transcoding profiles, commercials, manual schedule editing, or authentication.
- The Web Admin does not implement authoritative scheduling, playout timeline lookup, Plex formatting, or FFmpeg command construction.

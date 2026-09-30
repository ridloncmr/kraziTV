# kraziTV Glossary

Canonical vocabulary for kraziTV. Use these terms in code, tests, specs, ADRs,
and agent output. When a term here conflicts with a name elsewhere, the term
here wins unless the code has deliberately moved on; in that case update this
file in the same change.

- Add a term when it becomes shared vocabulary across files, docs, or agents.
- Keep each definition to one or two sentences. Link to the ADR or spec that
  owns the detail instead of repeating it.
- List rejected synonyms under **Avoid** so they do not creep back in.
- Mark terms that name unbuilt behavior as _Planned_.

## Core Architecture

| Term                       | Definition                                                                                                                                                                                                        | Avoid                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **kraziBrain**             | The scheduling and playout decision engine. Decides what plays, when it plays, and why. Lives in `packages/core`.                                                                                                 | scheduler service, programming engine   |
| **SignalPackager**         | The streaming and media normalization layer. Turns selected media into a continuous stream; owns FFmpeg command construction. See [ADR 0005](docs/adrs/0005-signal-packager-package-boundary.md).                 | encoder, transcoder (for the component) |
| **Provider adapter**       | The Plex-, Jellyfin-, or Emby-specific layer that exposes channels, guide data, and stream URLs. Never carries stream bytes.                                                                                      | integration, plugin, connector          |
| **Channel stream worker**  | The runtime worker that owns one shared broadcast signal for a watched channel and fans it out to subscribers. Code name `ChannelWorker`. See [ADR 0008](docs/adrs/0008-shared-active-channel-stream-workers.md). | per-viewer session, stream session      |
| **Channel stream manager** | Owns the set of active channel stream workers; starts a worker on first subscriber and reuses it for later ones. Code name `ChannelStreamManager`.                                                                | worker pool                             |

## Programming And Playout

| Term                 | Definition                                                                                                                                                     | Avoid                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Channel**          | A configured, continuously broadcasting lineup position that viewers tune to.                                                                                  | station, stream                |
| **Schedule**         | The guide-visible programming viewers see. Never includes things that are transmitted but not listed.                                                          | playlist, timeline (for this)  |
| **Schedule entry**   | One persisted, guide-visible program on a channel's schedule. The authority for guide output. See [ADR 0003](docs/adrs/0003-materialized-schedule-entries.md). | slot, listing                  |
| **Schedule anchor**  | The stable UTC millisecond at which a channel's schedule generation begins. Persisted as `anchorTime` in `ChannelScheduleState`.                               | start time, epoch              |
| **Horizon**          | How far into the future a channel's schedule entries are materialized. Horizon extension adds entries without rewriting covered windows.                       | lookahead, buffer              |
| **Gap repair**       | An explicit, logged regeneration when an enabled channel has no schedule entry covering the current time.                                                      | backfill, auto-fix             |
| **Regeneration**     | Deleting and rebuilding future schedule entries after an input change. Never alters the entry currently airing.                                                | reschedule, refresh            |
| **Playback mode**    | How a channel orders its media collection: `random` (deterministic, seeded) or `chronological` (collection order).                                             | shuffle mode                   |
| **Playout timeline** | Everything a channel actually transmits, derived from schedule entries. Includes non-guide items once filler exists.                                           | schedule, playlist             |
| **Playout item**     | One thing on the playout timeline. MVP items are derived on demand, one per schedule entry, and are not persisted.                                             | clip, segment                  |
| **Channel state**    | The deterministic runtime answer to "what is this channel transmitting right now, and at what offset?" Lets viewers join in progress.                          | now playing, session state     |
| **Join offset**      | The position inside the current playout item where a newly tuned viewer joins. Stored as `offsetMs`.                                                           | seek position, resume point    |
| **Filler**           | _Planned._ Non-program content used to cover time between programs.                                                                                            | padding                        |
| **Bumper**           | _Planned._ A short branded clip marking a transition into or out of a program or break.                                                                        | intro, sting (unless distinct) |

## Media Catalog

| Term                 | Definition                                                                                                                                                          | Avoid                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Media root**       | A registered filesystem location that is scanned for media. Answers "where is media?" See [ADR 0006](docs/adrs/0006-media-roots-and-collections.md).                | library, folder, source   |
| **Media collection** | An explicitly ordered set of media items that channels program from. Answers "what can be selected?" See [ADR 0006](docs/adrs/0006-media-roots-and-collections.md). | playlist, library         |
| **Media item**       | One cataloged file, identified by its media root and normalized absolute path. Status is `available`, `missing`, or `probe_failed`.                                 | asset, file record, video |
| **Catalog**          | The persisted inventory of media roots and media items.                                                                                                             | database, index           |
| **Catalog scan**     | One discover → probe → validate → persist pass over a media root. Commits atomically; a failed scan leaves prior statuses untouched.                                | import, sync, refresh     |
| **Probe**            | Running ffprobe against a file to read duration, streams, and codecs. A probe failure is stored, not thrown away.                                                   | analyze, inspect          |

## Broadcast And Provider Terms

Industry terms kraziTV relies on. Use them with these meanings.

| Term                    | Definition                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Linear TV**           | Programming that airs on a fixed timeline regardless of when a viewer tunes in. The behavior kraziTV simulates.                                |
| **Wall-clock time**     | Real UTC time. Channels advance at wall-clock speed whether or not anyone is watching. kraziTV stores time as integer milliseconds (ADR 0007). |
| **Broadcast signal**    | The single continuous encoded output of one active channel, shared by all of its viewers.                                                      |
| **Backpressure**        | A slow consumer pushing back on a producer. A viewer's backpressure must never slow a channel's broadcast signal.                              |
| **Tune**                | A viewer's client requesting a channel's stream. Tuning subscribes to the shared broadcast signal.                                             |
| **Subscriber**          | A viewer connection currently receiving a channel's broadcast signal.                                                                          |
| **Idle grace period**   | How long a channel stream worker keeps running after its last subscriber disconnects.                                                          |
| **EPG / guide data**    | Electronic program guide: the schedule as a client displays it.                                                                                |
| **XMLTV**               | The XML guide-data format kraziTV emits for Plex and other clients.                                                                            |
| **M3U**                 | A plain playlist of channel stream URLs, used by generic IPTV clients and for debugging.                                                       |
| **HDHomeRun emulation** | Exposing HDHomeRun-compatible discovery, device, status, and lineup endpoints so Plex treats kraziTV as a network tuner (ADR 0002).            |
| **Lineup**              | The list of channels a tuner advertises to a client.                                                                                           |
| **MPEG-TS**             | MPEG transport stream, the container kraziTV broadcasts. Designed for continuous streams that clients can join mid-flow.                       |
| **Transcode / remux**   | Transcoding re-encodes media; remuxing changes only the container. SignalPackager chooses between them, never kraziBrain.                      |

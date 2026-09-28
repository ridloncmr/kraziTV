# kraziTV

kraziTV is an easy-to-setup and easy-to-use Live TV emulator for Plex, with Jellyfin support planned.

It turns an existing media library into simulated 24/7 television channels with schedules, programming rules, commercial breaks, bumpers, and guide data.

The goal is to behave like a small broadcast automation system rather than a simple playlist generator.

## Tech Stack

- Runtime: Node.js
- Language: TypeScript
- API server: Fastify
- Database: SQLite
- Query layer: Drizzle or Kysely, to be decided during implementation
- Web UI: React, Vite, and TypeScript
- Scheduling: Node worker process initially
- Media inspection: ffmpeg and ffprobe via child processes
- Plex/Jellyfin integration: HTTP API clients
- Packaging: Docker later, native install later

## Planned Structure

```text
kraziTV/
  apps/
    server/      Fastify API, scheduler, XMLTV/M3U endpoints
    web/         React admin UI
  packages/
    core/        scheduling, channel rules, guide generation
    plex/        Plex API client
    jellyfin/    Jellyfin API client later
    media/       ffprobe helpers, duration, metadata utilities
  data/          local runtime data, gitignored
```

## Core Concepts

### Web UI

The Web UI is the primary configuration interface for kraziTV.

Users can:

- Create and delete channels
- Assign channel numbers
- Configure channel names and logos
- Select media libraries or collections
- Configure programming schedules
- Configure chronological or randomized playback
- Configure commercial breaks
- Configure bumpers and station IDs
- View upcoming programming
- View current channel state
- Manage Plex/Jellyfin integration

Example schedule:

```text
Channel 69 - Krazi Comedy

06:00 - 09:00
MASH

09:00 - 12:00
Monk

12:00 - 17:00
Mixed Comedy

17:00 - 20:00
Family Programming

20:00 - 22:00
Prime Time

22:00+
Adult Programming
```

### kraziBrain

kraziBrain is the programming and playout engine. Its job is to decide what should be playing.

kraziBrain does not encode video.

Responsibilities include:

- Channel scheduling
- Media selection
- Episode progression
- Playback history
- Randomization
- Repeat prevention
- Programming rules
- Commercial placement
- Bumper placement
- Station IDs
- Seasonal programming
- Schedule generation
- Current channel state
- Guide/EPG generation
- Media resolution

kraziBrain produces a playout timeline that is consumed by the SignalPackager.

Example playout timeline:

```text
19:59:45    Station ID
20:00:00    Weeds S01E01
20:11:20    Commercial
20:11:50    Commercial
20:12:20    Resume Weeds S01E01
20:25:00    Commercial
20:25:30    Resume Weeds S01E01
20:31:42    Bumper
20:32:00    Weeds S01E02
```

### Schedule vs Playout Timeline

kraziTV maintains two related but separate concepts.

The schedule represents what viewers see in the TV guide.

```text
20:00    Weeds
20:30    Weeds
21:00    Psych
22:00    Monk
```

The playout timeline represents everything actually transmitted by the channel.

```text
19:59:45    Station ID
20:00:00    Weeds S01E01
20:11:20    Commercial
20:11:50    Commercial
20:12:20    Resume Weeds S01E01
20:25:00    Commercial
20:25:30    Resume Weeds S01E01
20:31:42    Bumper
```

Commercials, bumpers, and station IDs generally should not appear as individual guide entries.

### Playout Items

Everything transmitted by kraziTV should be represented internally as a playout item.

Conceptual model:

```ts
type PlayoutItem = ProgramItem | CommercialItem | BumperItem | FillerItem;

type BasePlayoutItem = {
  durationSeconds: number;
};

type ProgramItem = BasePlayoutItem & {
  type: "program";
  mediaPath: string;
  startOffsetSeconds: number;
};

type CommercialItem = BasePlayoutItem & {
  type: "commercial";
  mediaPath: string;
};

type BumperItem = BasePlayoutItem & {
  type: "bumper";
  mediaPath: string;
};

type FillerItem = BasePlayoutItem & {
  type: "filler";
  mediaPath: string;
};
```

This keeps the downstream SignalPackager intentionally simple. It does not need to understand why something was selected; it only needs to know what to play and when.

### Channel State

Channels should behave as if they are continuously broadcasting. Opening a channel should join the currently-running broadcast rather than restart the current program.

Example:

```text
Program began:
20:00:00

Viewer tunes in:
20:17:43

Playback begins at:
00:17:43
```

Conceptual state:

```text
ChannelRuntimeState

ChannelId
CurrentProgram
CurrentPlayoutItem
ProgramStartedAt
PlayoutItemStartedAt
NextProgram
CurrentTimeline
```

Channel state should be deterministic enough that multiple clients tuning into the same channel receive approximately the same broadcast position.

### Commercial Breaks

Commercials are modeled primarily as planned timeline events rather than true asynchronous interruptions.

Example source program:

```text
████████████████████████████████████
```

kraziBrain identifies break locations:

```text
██████████|██████████|████████████
          ^          ^
```

The final timeline becomes:

```text
██████████
COMMERCIAL
COMMERCIAL
██████████
COMMERCIAL
████████████
```

This avoids timing and race-condition problems caused by interrupting the encoder in real time.

True interrupts may eventually exist for things such as:

- Emergency broadcasts
- Breaking news
- Manual channel takeover
- User-triggered station announcements

### Programming Rules

kraziBrain should support programming rules instead of requiring users to manually construct playlists.

Example:

```text
Channel: Krazi Comedy

06:00 - 09:00
    Collection: MASH
    Mode: Random

09:00 - 12:00
    Collection: Monk
    Mode: Chronological

12:00 - 17:00
    Mixed Comedy

    40% The Office
    30% Psych
    20% Weeds
    10% Random Comedy

17:00 - 20:00
    Family Programming

20:00 - 22:00
    Prime Time
    Continue series progression

22:00+
    Adult Programming
```

Possible rule features:

- Random episodes
- Chronological episodes
- Weighted collections
- No repeats within X days
- Time-of-day blocks
- Day-of-week blocks
- Seasonal programming
- Holiday programming
- Movie nights
- Theme nights
- Episode marathons
- Series marathons
- Specific scheduled events

Example seasonal rule:

```text
October:
    Halloween-tagged episodes receive 5x selection weight.

December:
    Christmas-tagged episodes enter rotation.
```

### SignalPackager

The SignalPackager receives playout instructions from kraziBrain and converts them into a continuous stream suitable for Plex or Jellyfin.

The SignalPackager should not contain programming logic.

Responsibilities include:

- Media decoding
- Transcoding
- Stream normalization
- Audio normalization
- Resolution normalization
- Framerate normalization
- Container conversion
- Timestamp management
- Concatenation
- Stream packaging
- Seeking into currently-playing media
- Maintaining continuous output

FFmpeg will likely be the primary underlying media engine.

For the initial version, source media should be normalized into a consistent channel format.

```text
Video:
    H.264
    1920x1080
    30 FPS

Audio:
    AAC

Container:
    MPEG-TS
```

For the first implementation, compatibility and reliability are more important than avoiding transcoding. Future versions may support stream copying when media already matches the channel profile.

Conceptually:

```text
if source is compatible with channel profile:
    stream copy
else:
    transcode
```

Example SignalPackager input:

```json
{
  "channel": "KRAZI-1",
  "items": [
    {
      "type": "program",
      "file": "/media/Weeds/S01E01.mkv",
      "startOffset": 0
    },
    {
      "type": "commercial",
      "file": "/media/commercials/pepsi-1997.mp4"
    },
    {
      "type": "bumper",
      "file": "/media/krazitv/coming-up-next.mp4"
    }
  ]
}
```

## Provider Integration

The ingestion layer exposes kraziTV channels to supported media servers.

Initial target:

- Plex

Future targets:

- Jellyfin
- Emby

Provider-specific behavior should live behind an abstraction. Plex-specific assumptions should not leak into the core scheduling or playout logic.

### Plex

The Plex adapter is responsible for making kraziTV appear as a Live TV source.

Responsibilities may include:

- Exposing available channels
- Exposing tuner information
- Providing channel streams
- Providing guide data
- Mapping kraziTV channels to Plex channels

Conceptually:

```text
Plex
  |
  v
kraziTV Plex Adapter
  |
  +---- Channel Metadata
  |
  +---- Guide / EPG
  |
  +---- Live Stream
```

### Jellyfin

Jellyfin support should use the same core scheduling and signal architecture.

The Jellyfin adapter may expose:

- M3U channel playlists
- XMLTV guide data
- Live stream endpoints

The exact provider integration should remain isolated from kraziBrain.

## Proposed Data Model

SQLite should be sufficient for the initial implementation.

### Channel

```text
Id
Name
Number
Logo
EncodingProfile
Enabled
```

### MediaCollection

```text
Id
Name
Type
```

### MediaItem

```text
Id
CollectionId
Path
Series
Season
Episode
Title
Duration
Metadata
```

### ProgramRule

```text
Id
ChannelId
DaysOfWeek
StartTime
EndTime
SelectorType
SelectorConfig
Priority
```

### PlaybackHistory

```text
ChannelId
MediaItemId
PlayedAt
```

### Commercial

```text
Id
Path
Duration
Tags
Weight
```

### ScheduleEntry

```text
Id
ChannelId
MediaItemId
StartsAt
EndsAt
```

### PlayoutEntry

```text
Id
ChannelId
Type
MediaPath
StartsAt
EndsAt
SourceScheduleEntryId
```

## High-Level Architecture

```text
                        +-----------------------+
                        |       kraziTV UI      |
                        |                       |
                        | Channels              |
                        | Programming           |
                        | Libraries             |
                        | Commercials           |
                        | Settings              |
                        +-----------+-----------+
                                    |
                                    v

+-------------------------------------------------------------+
|                         kraziBrain                          |
|                                                             |
|  Scheduler                                                  |
|  Media Resolver                                             |
|  Programming Rules                                          |
|  Playback History                                           |
|  Commercial Manager                                         |
|  Channel Runtime State                                      |
|  Guide Generator                                            |
|                                                             |
+----------------------------+--------------------------------+
                             |
                             | Playout Timeline
                             v

                    +-----------------------+
                    |    SignalPackager     |
                    |                       |
                    | FFmpeg                |
                    | Decode                |
                    | Normalize             |
                    | Transcode             |
                    | Concatenate           |
                    | Package               |
                    +-----------+-----------+
                                |
                     Continuous TV Signal
                                |
             +------------------+------------------+
             |                                     |
             v                                     v

    +-------------------+               +-------------------+
    |   Plex Provider   |               | Jellyfin Provider |
    |                   |               |                   |
    | Channels          |               | M3U               |
    | Guide             |               | XMLTV             |
    | Streams           |               | Streams           |
    +---------+---------+               +---------+---------+
              |                                   |
              v                                   v

            Plex                               Jellyfin
```

## Request Flow

When a client tunes into a channel:

```text
Plex
  |
  | Request Channel 69
  v

Plex Provider
  |
  | Request current channel stream
  v

kraziBrain
  |
  | Determine current playout position
  |
  | Channel 69
  | Weeds S01E01
  | Started 17 minutes ago
  v

SignalPackager
  |
  | Open source media
  | Seek to current position
  | Encode/package signal
  v

Plex Provider
  |
  v

Plex Client
```

## First Milestone

- Create the TypeScript monorepo
- Build a server health endpoint
- Add a SQLite schema for channels, media, and schedules
- Add a basic WebUI shell
- Add Plex connection configuration
- Generate a simple simulated channel schedule
- Expose XMLTV and M3U endpoints for Plex

## MVP Scope

The first release should intentionally be small.

Support:

- Plex
- One or more channels
- Local media
- Simple schedule generation
- Random playback
- Chronological playback
- Continuous channel state
- Basic Web UI
- Basic guide data
- FFmpeg MPEG-TS output

Do not initially build:

- Commercials
- Jellyfin
- Seasonal rules
- Theme programming
- Advanced transcoding profiles
- Manual interrupts
- Complex media tagging
- AI-based programming
- Dynamic advertisements

## MVP Success Criteria

The first major milestone is:

```text
1. Start kraziTV.

2. Create a channel.

3. Select a media collection.

4. Configure the channel.

5. Open Plex.

6. Navigate to Live TV.

7. Select the kraziTV channel.

8. See the currently-running program.

9. Tune in halfway through an episode.

10. Receive the stream from approximately the correct broadcast position.
```

Example:

```text
69 - Krazi Comedy

NOW:
Weeds

8:00 PM - Weeds
8:30 PM - Weeds
9:00 PM - Psych
10:00 PM - Monk
```

If a user tunes in at 8:17 PM, they should join the episode approximately 17 minutes into the simulated broadcast.

## Future Features

Potential future features include:

- Commercial blocks
- Retro commercials
- Station IDs
- Bumpers
- Coming Up Next segments
- Seasonal programming
- Holiday programming
- Movie nights
- Theme nights
- Marathons
- Random channel generation
- Channel templates
- Multiple encoding profiles
- Hardware encoding
- Direct stream / stream copy
- Jellyfin support
- Emby support
- Manual station takeover
- Emergency broadcast simulation
- Custom channel branding
- Automatic logo generation
- Program ratings
- Parental controls
- Multiple audio tracks
- Subtitle handling
- DVR-aware scheduling
- Remote media sources
- Network media libraries
- Automatic media discovery

## Design Principles

### kraziBrain decides what plays

kraziBrain owns:

```text
WHAT
WHEN
WHY
```

It should not care about codecs, containers, or FFmpeg command construction.

### SignalPackager decides how it plays

SignalPackager owns:

```text
HOW
```

It should not care why a file was chosen.

### Providers decide where the signal goes

Provider adapters own:

```text
WHERE
```

Examples:

```text
Plex
Jellyfin
Emby
```

## Project Philosophy

kraziTV is not intended to simply generate playlists. It is intended to emulate a television network.

The system should behave as if channels are continuously broadcasting whether anybody is watching them or not.

At any given moment:

```text
Channel 69 is playing something.

Channel 70 is playing something.

Channel 71 is playing something.
```

When a viewer tunes in, they join the broadcast already in progress.

This allows kraziTV to recreate the parts of traditional television that are often lost with on-demand media:

- Discovering something already playing
- Channel surfing
- Shared schedules
- Prime-time programming
- Theme blocks
- Holiday programming
- Commercial breaks
- Station branding
- The feeling that the channel exists independently of the viewer

In short:

> kraziTV is a deterministic, stateful television network simulator whose output happens to be consumable by Plex and Jellyfin.

## Development

Project setup is in progress.

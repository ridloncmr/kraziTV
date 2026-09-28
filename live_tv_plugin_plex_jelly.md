# kraziTv

Easy-to-setup and easy-to-use Live TV emulator for Plex, with Jellyfin support planned.

kraziTv turns an existing media library into simulated 24/7 television channels with schedules, programming rules, commercial breaks, bumpers, and guide data.

The core idea is to behave like a small broadcast automation system rather than a playlist generator.

---

# Core Concepts

## WebUI

The WebUI is the primary configuration interface for kraziTv.

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

Example:

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

---

# kraziBrain™

kraziBrain is the programming and playout engine.

Its job is to decide **what should be playing**.

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

Example:

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

---

# Schedule vs Playout Timeline

kraziTv maintains two related but separate concepts.

## Schedule

The schedule represents what viewers see in the TV guide.

Example:

```text
20:00    Weeds
20:30    Weeds
21:00    Psych
22:00    Monk
```

This is what should appear in Plex or Jellyfin guide data.

## Playout Timeline

The playout timeline represents everything actually transmitted by the channel.

Example:

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

---

# PlayoutItem

Everything transmitted by kraziTv should be represented internally as a `PlayoutItem`.

Example conceptual model:

```csharp
public abstract record PlayoutItem
{
    public required TimeSpan Duration { get; init; }
}

public record MediaItem : PlayoutItem
{
    public required string Path { get; init; }
}

public record CommercialBlock : PlayoutItem
{
    public required IReadOnlyList<MediaItem> Commercials { get; init; }
}

public record BumperItem : PlayoutItem
{
    public required string Path { get; init; }
}

public record FillerItem : PlayoutItem
{
    public required string Path { get; init; }
}
```

This keeps the downstream SignalPackager intentionally simple.

The SignalPackager does not need to understand why something was selected.

It only needs to know what to play and when.

---

# Channel State

Channels should behave as if they are continuously broadcasting.

Opening a channel should join the currently-running broadcast rather than restart the current program.

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

---

# Commercial Breaks

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

---

# Programming Rules

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

---

# SignalPackager

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

---

# Encoding Profile

For the initial version, source media should be normalized into a consistent channel format.

Example:

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

Source media may include:

```text
H.264
H.265
MPEG-4

480p
720p
1080p
4K

23.976 FPS
24 FPS
29.97 FPS
30 FPS
60 FPS

AAC
AC3
EAC3
MP3
```

For the first implementation, compatibility and reliability are more important than avoiding transcoding.

Future versions may support stream copying when media already matches the channel profile.

Conceptually:

```text
if source is compatible with channel profile:
    stream copy
else:
    transcode
```

---

# SignalPackager Input

kraziBrain may provide instructions similar to:

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

The SignalPackager does not need to know why these items were selected.

It simply converts the requested playout sequence into a valid television stream.

---

# Ingestion Pipeline

The ingestion layer exposes kraziTv channels to supported media servers.

Initial target:

- Plex

Future target:

- Jellyfin

Potential future target:

- Emby

The ingestion layer should remain separate from kraziBrain and SignalPackager.

---

# Provider Adapter

Provider-specific behavior should live behind an abstraction.

Example:

```csharp
public interface ITvProvider
{
    Task PublishChannels(...);

    Task PublishGuide(...);

    Task<Stream> GetStream(ChannelId channel);
}
```

Possible projects/modules:

```text
KraziTv.Core

KraziTv.Brain

KraziTv.Signal

KraziTv.Web

KraziTv.Provider.Plex

KraziTv.Provider.Jellyfin
```

Plex-specific assumptions should not leak into the core scheduling or playout logic.

---

# Plex Integration

The Plex adapter is responsible for making kraziTv appear as a Live TV source.

Responsibilities may include:

- Exposing available channels
- Exposing tuner information
- Providing channel streams
- Providing guide data
- Mapping kraziTv channels to Plex channels

Conceptually:

```text
Plex
  |
  v
kraziTv Plex Adapter
  |
  +---- Channel Metadata
  |
  +---- Guide / EPG
  |
  +---- Live Stream
```

---

# Jellyfin Integration

Jellyfin support should use the same core scheduling and signal architecture.

The Jellyfin adapter may expose:

- M3U channel playlists
- XMLTV guide data
- Live stream endpoints

The exact provider integration should remain isolated from kraziBrain.

---

# Proposed Data Model

SQLite should be sufficient for the initial implementation.

## Channel

```text
Id
Name
Number
Logo
EncodingProfile
Enabled
```

## MediaCollection

```text
Id
Name
Type
```

## MediaItem

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

## ProgramRule

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

## PlaybackHistory

```text
ChannelId
MediaItemId
PlayedAt
```

## Commercial

```text
Id
Path
Duration
Tags
Weight
```

## ScheduleEntry

```text
Id
ChannelId
MediaItemId
StartsAt
EndsAt
```

## PlayoutEntry

```text
Id
ChannelId
Type
MediaPath
StartsAt
EndsAt
SourceScheduleEntryId
```

---

# High-Level Architecture

```text
                        ┌───────────────────────┐
                        │       kraziTv UI      │
                        │                       │
                        │ Channels              │
                        │ Programming           │
                        │ Libraries             │
                        │ Commercials           │
                        │ Settings              │
                        └───────────┬───────────┘
                                    │
                                    ▼

┌─────────────────────────────────────────────────────────────┐
│                         kraziBrain™                         │
│                                                             │
│  Scheduler                                                  │
│  Media Resolver                                             │
│  Programming Rules                                          │
│  Playback History                                           │
│  Commercial Manager                                         │
│  Channel Runtime State                                      │
│  Guide Generator                                            │
│                                                             │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ Playout Timeline
                             ▼

                    ┌───────────────────────┐
                    │    SignalPackager     │
                    │                       │
                    │ FFmpeg                │
                    │ Decode                │
                    │ Normalize             │
                    │ Transcode             │
                    │ Concatenate           │
                    │ Package               │
                    └───────────┬───────────┘
                                │
                     Continuous TV Signal
                                │
             ┌──────────────────┴──────────────────┐
             │                                     │
             ▼                                     ▼

    ┌───────────────────┐               ┌───────────────────┐
    │   Plex Provider   │               │ Jellyfin Provider │
    │                   │               │                   │
    │ Channels          │               │ M3U               │
    │ Guide             │               │ XMLTV             │
    │ Streams           │               │ Streams           │
    └─────────┬─────────┘               └─────────┬─────────┘
              │                                   │
              ▼                                   ▼

            Plex                               Jellyfin
```

---

# Request Flow

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

---

# MVP

The first release should intentionally be small.

## Scope

Support:

- Plex
- One or more channels
- Local media
- Simple schedule generation
- Random playback
- Chronological playback
- Continuous channel state
- Basic WebUI
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

---

# MVP Success Criteria

The first major milestone is:

```text
1. Start kraziTv.

2. Create a channel.

3. Select a media collection.

4. Configure the channel.

5. Open Plex.

6. Navigate to Live TV.

7. Select the kraziTv channel.

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

If a user tunes in at:

```text
8:17 PM
```

they should join the episode approximately 17 minutes into the simulated broadcast.

---

# Future Features

Potential future features include:

- Commercial blocks
- Retro commercials
- Station IDs
- Bumpers
- "Coming Up Next" segments
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

---

# Design Principles

## kraziBrain decides what plays

kraziBrain owns:

```text
WHAT
WHEN
WHY
```

It should not care about codecs, containers, or FFmpeg command construction.

---

## SignalPackager decides how it plays

SignalPackager owns:

```text
HOW
```

It should not care why a file was chosen.

---

## Providers decide where the signal goes

Provider adapters own:

```text
WHERE
```

Example:

```text
Plex
Jellyfin
Emby
```

---

# Project Philosophy

kraziTv is not intended to simply generate playlists.

It is intended to emulate a television network.

The system should behave as if channels are continuously broadcasting whether anybody is watching them or not.

At any given moment:

```text
Channel 69 is playing something.

Channel 70 is playing something.

Channel 71 is playing something.
```

When a viewer tunes in, they join the broadcast already in progress.

This allows kraziTv to recreate the parts of traditional television that are often lost with on-demand media:

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

> kraziTv is a deterministic, stateful television network simulator whose output happens to be consumable by Plex and Jellyfin.
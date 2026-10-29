# TV Program

Status: Implemented

TV is a desktop program that plays a channel's broadcast signal in the
browser, so the owner can watch kraziTV without Plex. It is one more viewer:
it tunes the same stream route Plex does and subscribes to the same shared
signal.

## Problem

The only way to see what a channel was actually transmitting was a Plex
client. Setting up channels meant switching to a TV or the Plex app to check
the result, and someone without Plex set up could not watch at all.

## Goals

- Watch any enabled channel in the browser, joining in progress as Plex does.
- Change channel the way a TV does: up and down the lineup, or straight to
  one from a list.
- Show what airs now and next under the picture.
- Open TV on a channel from My Channels and from the Program Guide.
- Keep the XP desktop look: TV is a desktop program in its own window.

## Non-goals

- Live Monitor stays a separate program for channel state and, later,
  server metrics.
- No pause, rewind, or recording. TV shows the channel live, as broadcast.
- No per-viewer encoding. TV adds a subscriber, never a session.
- No picture-in-picture or several TVs at once; TV is a singleton desktop
  program.

## User-Facing Behavior

- TV is on the desktop and in Start under **Primary**. Opened on its own, it
  tunes the channel this browser last watched while that channel is still
  enabled, otherwise the first enabled channel in lineup order.
- **Watch** in My Channels (row menu and the button under the grid) and a
  click on an enabled channel's name in the Program Guide open TV on that
  channel, or retune TV when it is already open. A channel newer than TV's
  list keeps the current one on screen until the list is read again. A disabled channel offers
  no Watch.
- The picture fills the window above a strip that reads what airs now and
  next, worded as My Channels' **On now** column words it. On tuning, the
  channel's number and name show over the picture for four seconds.
- **CH ▲** and **CH ▼** step through enabled channels in lineup order and
  wrap at either end. The **Channel** list names every channel, with
  disabled ones listed but not choosable.
- **Mute** and the **Volume** slider set the sound; moving the slider turns
  the sound back on. This browser remembers the channel, volume, and mute.
- **Full screen**, or a double-click on the picture, shows the picture alone
  full screen; Esc or **Exit full screen** leaves.
- The screen says **Tuning…** until the picture plays. When a stream cannot
  play it reads **No signal** with the reason and **Try again**:

  | Cause                                  | Words                                                  |
  | -------------------------------------- | ------------------------------------------------------ |
  | `409` nothing airing, or just disabled | This channel has nothing on air, or was just disabled. |
  | `404` channel gone                     | This channel no longer exists.                         |
  | `503` startup failure                  | The channel couldn't start its broadcast.              |
  | Any other refusal                      | kraziTV couldn't send this channel.                    |
  | Network failure                        | Can't reach kraziTV.                                   |
  | The stream ended                       | The broadcast stopped.                                 |
  | Undecodable media, or no MSE support   | This browser can't play the broadcast.                 |

- When the browser blocks sound until a click, the screen offers **Turn on
  the TV**.
- With no enabled channel, the screen says so and offers **Open My
  Channels**.

## Technical Behavior

- TV reads `GET /channels` and plays `GET /channels/:id/stream`, the
  provider-neutral stream route, through mpegts.js, which remuxes MPEG-TS
  for Media Source Extensions. The route is public, so the player sends no
  cookie. The strip reuses `ChannelNowNext`, which polls
  `GET /channels/:id/now`.
- The player runs live, without latency chasing: the join backlog
  ([ADR 0018](../../../../adrs/0018-join-backlog.md)) fills its buffer, so the
  picture runs about ten seconds behind the schedule, as Plex's does, and the
  strip can turn over that much before the picture. Browsers need timestamps
  that only run forward across splices, which
  [ADR 0021](../../../../adrs/0021-continuous-splice-timestamps.md) provides.
- mpegts.js loads only when TV first tunes, so the desktop bundle does not
  grow for owners who never open TV.
- Changing channel, Try again, and closing the window destroy the player,
  which closes the stream request and ends this viewer's subscription; the
  channel stream worker's idle grace period applies as for any viewer.
  Minimizing keeps it playing, as a minimized media player does.
- The shell holds the latest Watch request as a channel ID and a count,
  as it holds Account Settings' TMDB task request, so watching the same
  channel twice still reaches an open TV. It clears the request when TV
  closes.
- Code lives in `apps/web/src/tv/`. The channel, volume, and mute are desktop
  shell state in `localStorage` under `krazitv.tv`.

## Architecture Boundaries

- TV is a subscriber like any Plex client. It never starts a second encode
  or asks for per-viewer output.
- The browser decides nothing about what airs. The picture is the signal and
  the strip is the server's channel state.
- No provider adapter changes: the stream route is provider-neutral.

## Acceptance Criteria

- Opening TV tunes the remembered enabled channel, else the first enabled
  one, and its stream URL is that channel's stream route.
- CH ▲/▼ skip disabled channels and wrap; choosing from the list tunes that
  channel; each change stops the previous broadcast.
- A Watch from My Channels or the guide tunes that channel, including a
  repeat of the same channel.
- Volume and mute apply to the picture and are remembered with the channel.
- Each stream failure shows **No signal** with its words, and Try again tunes
  afresh; a failure from a broadcast already left shows nothing.
- Closing TV stops its broadcast.
- In Chromium, a real channel plays across a program boundary without the
  picture freezing.

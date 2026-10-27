# Program Guide Grid

Status: Implemented

This spec replaces the Program Guide described in
[0008-web-admin](0008-web-admin.md) under **Schedule And Current State UI**: a
channel dropdown over one channel's table of upcoming entries. The Program
Guide becomes a guide grid, as a television guide is: every channel down the
side, the next 24 hours across, and a line at the current time. Live Monitor
keeps the one-channel view of current state.

## Problem

The guide is the one screen where kraziTV looks like a television network
rather than an administration form, and it looked like a query form: choose a
channel, read a table. Nothing showed what every channel was doing at once, or
where now fell in the day.

## Goals

- Show every channel's programming for the next 24 hours at once, laid out in
  time, with the current instant marked.
- Keep planned filler visible as **Off air**, as [programming spec 0006](../../002-programming/specs/0006-clock-anchored-blocks.md)
  requires, in its place in time.
- Keep the browser out of scheduling: it draws what the server reports and
  never computes what airs.

## Non-goals

- Direct manipulation of the grid, such as dragging programs, which
  [programming spec 0007](../../002-programming/specs/0007-manual-programming.md)
  defers.
- A half-hour broadcast clock; blocks sit where the server's entries start and
  end.
- Program details beyond title and times.

## User-Facing Behavior

- Opening Program Guide shows the grid at once: each channel is a row named by
  its number and name, with a **Disabled** badge where it is disabled, and 24
  hours run left to right from the top of the current half hour, as a broadcast
  guide's grid does.
- A ruler across the top names each whole hour, and names the day where one
  begins. Half-hour lines run down the grid.
- Each program is a block at its start and end, reading its title and start
  time; a block too narrow to read keeps them in its tool tip. The block
  airing now is title-bar blue. Planned filler is a dashed **Off air** block.
- A line marks the current time and moves once a minute while the window is
  in view. The guide moves to the current half hour whenever the window comes
  back into view or reloads, so a restored or refocused window shows today,
  and a guide left at its left edge follows the clock into the next half
  hour. A guide scrolled ahead stays where the reader put it; **Now**, in the
  ruler's corner, brings it back to the current half hour and its left edge.
- A channel with nothing in the window reads **Nothing scheduled**. With no
  channels at all, the guide says so and points to My Channels.
- The channel names stay in view while the grid scrolls sideways, and the
  ruler stays in view while it scrolls down.

## Technical Behavior

- The grid reads `GET /channels`, then each row reads that channel's schedule
  window for 24 hours from the anchor through the existing
  `scheduleWindowPath`, so rows arrive independently and a failed read shows
  in its own row.
- Placement is presentation arithmetic in `guide-geometry.ts`: four pixels a
  minute, a block clipped to the window, and the whole hours inside it. It
  takes the server's instants and never derives playout state.
- The now line uses browser time only to mark the ruler; what is airing is
  the block the server's own start and end enclose.
- Code lives in `apps/web/src/program-guide/`, with its stylesheet beside it.

## Architecture Boundaries

- kraziBrain decides what plays; the guide draws it. No scheduling or playout
  decision moves into the browser.
- Provider output is unchanged: XMLTV still lists entries only.

## Acceptance Criteria

- Every channel appears as a row in lineup order, disabled ones badged.
- A channel's programs and Off air intervals appear in time order, each at
  the left and width its times give, clipped to the window.
- The program whose times enclose now is marked as airing.
- A channel with nothing scheduled says so; a failed row read shows its error
  in that row without hiding the others.
- Each row's schedule request asks for 24 hours from the anchor, the top of
  the current half hour, and asks again from the new one when the guide
  reloads in a later half hour or **Now** is pressed.

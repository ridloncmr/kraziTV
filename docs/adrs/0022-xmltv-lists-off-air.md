# 0022 XMLTV Lists Planned Filler As Off Air

## Status

Accepted on 2026-10-28. Supersedes the part of
[ADR 0014](0014-planned-filler-coverage.md) that keeps planned filler out of
XMLTV ("XMLTV and guide entries never list it" and "XMLTV is unchanged").
The rest of ADR 0014 stands: filler is still derived and never persisted,
and it is still never a schedule entry.

## Context

ADR 0014 made planned filler derived coverage and kept XMLTV to schedule
entries. Plex shows a time with no programme as an empty slot or stretches
its neighbours across it. While filler aired, the Plex guide said nothing
about it, even though the picture read **Programming resumes at <time>**
and the kraziTV Program Guide already showed **Off air**.

## Decision

- **XMLTV lists each planned filler interval as a programme.** It sits among
  the channel's programmes in start order and spans the filler's start to
  its resume time.
- **It reads Off air.** The title is `Off air` and the description is the
  on-screen message, such as `Programming resumes at 8:00 PM.`, worded in
  the programming timezone by the same function the on-screen message uses.
  It has no category, artwork, date, or episode number.
- **It comes from the same derivation.** The XMLTV route reads the filler
  intervals `readWindow` already returns from the schedule snapshot, so
  Plex, the Program Guide, and what transmits always agree.
- **Filler is still not a schedule entry.** No row, ID, or entry is added,
  and readers of schedule entries never see filler. Only the provider
  output gains it.

## Consequences

- The Plex guide shows **Off air** with the resume time wherever a channel
  transmits planned filler.
- Plex may badge or record an Off air programme like any other. Like every
  kraziTV programme it is marked previously shown, so Plex does not treat
  it as new.
- Unexplained gaps (`schedule_gap`) are still not listed; only planned
  filler is.
- Stand-ins ([ADR 0020](0020-failed-item-stand-in.md)) are unplanned and are
  still not listed.

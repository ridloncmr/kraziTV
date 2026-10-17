# 0015 A Reservation May Cut The Airing Item At Its Start

## Status

Accepted on 2026-10-16. Amends [ADR 0003](0003-materialized-schedule-entries.md)'s
interruption rule, [ADR 0008](0008-shared-active-channel-stream-workers.md)'s
rule that the transmitting item keeps its end, and
[ADR 0014](0014-planned-filler-coverage.md)'s airing filler protection.

## Context

[Programming spec 0007](../specs/features/002-programming/specs/0007-manual-programming.md)
lets the owner start a reservation while something is airing, either now or
at a chosen later instant inside the airing item, such as 7:45 PM during an
episode that runs to 8:05 PM.

The existing interruption path, used by fresh rebuild and catalog removal,
deletes the airing entry, regenerates from now, and stops the channel stream
worker, so viewers must tune in again. That suits an immediate administrative
change made by an owner at the controls. It does not suit a cut planned for a
later instant: nobody is at the controls then, and every viewer would be
dropped without warning.

The channel stream worker fixes its next boundary when an item starts
airing and never learns of an earlier end, so today it cannot switch early
without being stopped.

## Decision

- **A reservation may interrupt.** A reservation that the owner explicitly
  marks as interrupting may start inside the airing playout item, program or
  filler, at any instant from now until that item ends. Every other
  reservation is still refused when it crosses the airing item. kraziTV never
  marks one on its own.
- **The cut is derived, never persisted.** The airing entry keeps its stored
  times. Playout, the guide, and the regeneration boundary read the item as
  ending at the interrupting reservation's start, derived in the same schedule
  snapshot as filler. Editing or deleting the reservation before that instant
  restores the item's full airtime with nothing to undo.
- **The cut is seamless.** At the cut instant the channel stream worker
  crosses into the reservation the way it crosses any boundary, keeping its
  subscribers. After a schedule revision change it re-reads the airing item's
  end and moves its boundary earlier when the cut requires it. A cut at "now"
  is the same path; the worker crosses as soon as the reservation is ready and
  joins it at its offset.
- **The cut item counts as aired.** Its playback progress stands, as it does
  for any item that started airing.
- **Ending a running reservation early** moves its end earlier: to the airing
  program's end when the owner lets it finish, or to a chosen instant inside
  that program. A reservation whose end falls inside its own airing program
  cuts that program at its end, derived and seamless like any other cut, and
  normal programming follows.
- **Existing immediate interruptions are unchanged.** Fresh rebuild and catalog
  removal keep stopping the worker. Moving them to the seamless cut needs its
  own decision.

## Consequences

- SignalPackager must end the airing FFmpeg process early at the cut instant
  and continue the signal session into the next item without a gap.
- The worker's sleep before a boundary must wake on a revision change, so an
  earlier end is noticed within the prepare lead.
- The transition coordinator revalidates a candidate against the derived end,
  so a preparation made before a cut, or before the cut was withdrawn, is stale.
- The guide and XMLTV show the cut program ending at the cut instant.
- An interrupting reservation's edits and deletes run under the same write
  authority and revision rules as any reservation write (ADR 0014).

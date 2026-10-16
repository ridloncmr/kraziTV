# 0014 Planned Filler Is Derived Coverage

## Status

Accepted on 2026-10-16. Amends [ADR 0003](0003-materialized-schedule-entries.md)'s
gap-repair, schedule-revision, regeneration-boundary, and transition
revalidation rules, and the matching revalidation wording in
[ADR 0008](0008-shared-active-channel-stream-workers.md) and the "applies
unchanged" note in [ADR 0009](0009-programming-blocks.md).

## Context

[Programming spec 0006](../specs/features/002-programming/specs/0006-clock-anchored-blocks.md)
adds **reservations**: exact-start reserved time ranges that ordinary
programming must stop whole before. The time between the last program that
fits and the reservation, and any unused time at the end of an explicit
range, is transmitted as **filler**: a black screen reading **Programming
resumes at <time>** with silence. Filler is never a guide program.

Three ADR 0003 rules assume every transmitted instant has a schedule entry:

- An enabled, schedulable channel with no entry covering the current time
  needs a logged gap repair. Planned filler has no entry by design.
- The schedule revision advances when the persisted entry set changes. A
  reservation edit can change planned filler without changing any entry, for
  example by moving an explicit end, and a worker's prepared filler would then
  commit under a revision that no longer describes it.
- The playout cursor is a schedule entry ID. Filler has none.

## Decision

- **Planned filler is coverage, not a gap.** Filler is derived per
  reservation, whose range is half-open `[startsAt, endsAt)`: the time from
  the end of the last program that starts before the reservation to its first
  program, or to its end when none of its programs fits, and the time from its
  last program to its explicit end. Overlapping or touching intervals merge
  into one. The tail is filler whether or not a later entry exists yet. A
  filler with no earlier program starts at the schedule anchor. Any other gap
  is unexplained and reports `schedule_gap`. Generation advances coverage to
  at least each reservation's end, so planned filler always lies inside
  coverage.
- **Gap repair fires when coverage has lapsed.** That is how the code has
  always triggered it. An unexplained gap inside coverage reports
  `schedule_gap` and is not repaired; planned filler never reports it.
- **Filler is derived, never persisted.** kraziBrain derives it from entries
  and reservations read in the same schedule snapshot, with one function
  every playout read uses. A filler's end is its resume time: where
  guide-visible programming next starts. No filler row, ID, or
  schedule entry exists, so XMLTV and guide entries never list it.
- **The playout cursor names a program or a filler.** It is
  `{ kind: "program", scheduleEntryId }` or `{ kind: "filler", endsAt }`. A
  filler is identified by its end, which is protected while it airs; its
  start can move earlier when purge deletes the ended program before it, which
  changes only the reported start and join offset. A filler cursor is stale
  when no filler ends at that instant under the current derivation, exactly
  as a program cursor is stale when its entry is gone. Transition candidates
  carry the same cursor, and the transition coordinator revalidates the
  airing playout item, program or filler, where ADR 0003 and ADR 0008 say
  entry.
- **The schedule revision counts changes to planned transmission.** Every
  transaction that changes the persisted entry set, ordering, or contents, or
  any input that determines filler, advances `scheduleRevision` exactly once
  in the same commit. A reservation create, edit, or delete commits with its
  regeneration in one immediate transaction and advances the revision once
  even when no entry changes. No second counter is added, so the transition
  coordinator's single revision check invalidates stale filler and program
  preparations alike.
- **Airing filler is protected like an airing entry.** The regeneration
  boundary is the end of the airing playout item, program or filler. Routine
  edits keep an airing filler's content, end, and resume time. A reservation
  edit or delete that would change the airing filler's end, or the
  reservation it leads into, is refused with `airing_filler_conflict`; the
  user's explicit interruption (spec 0007) is the only other path.
- **Ownership is unchanged.** kraziBrain owns fit, deferral, and filler
  timing. The server formats the resume message in the programming timezone.
  SignalPackager renders the filler it is given for the airtime it is given
  and never sees a timezone or a reservation. One channel stream worker
  transmits programs and filler on one shared signal (ADR 0008).

## Consequences

- Guide windows can contain intentional non-program intervals. The kraziTV
  Program Guide labels them **Off air**; XMLTV is unchanged.
- A missing guide entry during planned filler never produces `schedule_gap`
  or a gap repair. An unexplained gap inside coverage still reports
  `schedule_gap`, and lapsed coverage is still repaired.
- A filler's start reaches back to the last program before it. When that
  program left the schedule, by purge, interruption, or an earlier gap repair,
  the filler also covers that earlier empty time, which is in the past. The
  guide shows it **Off air** rather than empty.
- Reservation writes always advance the revision, so a worker may discard a
  still-valid preparation after an edit that changed nothing it airs. That
  costs one fresh selection at the boundary and never a wrong commit.
- Every playout read and the transition coordinator read reservations in the
  same snapshot or immediate transaction as entries.
- Filler identity is its end instant, so concurrent coverage requests can
  never create duplicate filler.
- Should filler ever need persisted identity, such as user-selected filler
  clips, that extension needs a new decision; this ADR reserves none.

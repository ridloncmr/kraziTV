# Clock-Anchored Programming And Boundary Coverage

Status: Implemented

## Problem

A soft preference cannot promise a program begins at 8 PM. Exact starts require
an explicit policy for programs that do not fit before the boundary and for the
remaining transmission time, without pretending filler is a guide program.

## Goals

- Support deliberately reserved exact future starts.
- Preserve whole-program ordering and cover the interval before a reservation.
- Distinguish guide-visible programs from non-guide filler in playout.
- Provide the boundary capability needed by manual programming publication.

## Non-goals

- A universal broadcast-clock designer or mandatory half-hour guide grid.
- Cutting ordinary episodes or movies to force them into a remaining interval.
- Commercial campaigns, branded presentation rules, or emergency missing-media substitution.
- User-selected filler clips, including clip repetition and configuration.
- Recurring-rule weighting or manual draft storage/publication.

## Dependencies And Spec Boundary

Depends on [multi-source programming](0004-kraziplan.md) and integrates
[recurring rules](0005-recurring-programming-rules.md) when present. Exact boundary
coverage is distinct from approximate airtime and from the override lifecycle in
spec 0007. Deliver a narrow server capability and preview, not a second manual editor.

This spec adds no administration UI for creating or editing reservations; its
behavior is proven through server tests. [Spec 0007](0007-manual-programming.md)
owns the owner-facing screens that create reservations through this capability,
so the two ship together. The Program Guide's **Off air** display of planned
filler belongs here because it only reads coverage.

## Established Behavior And Proposed Policy

Schedules currently contain contiguous whole-program entries. Playout is derived
one-to-one from them, with schedule-entry identity as its cursor. Existing black
tail handles media shorter than its published airtime; it is not a general filler
scheduling policy. The richer playout and reservation behavior here is proposed.

## User-Facing Behavior

A clock-anchored block has an explicit UTC start and source. Support both an
explicit end and an end derived from the selected programs' durations. The preview
distinguishes an exact commitment from a soft preference and
shows any filler interval required before it. Reject overlapping reservations or
ones that would unexpectedly interrupt the currently airing item.

Preserve next-program ordering. If that program
cannot finish before the reservation, defer it and cover the remaining interval.
Do not search later episodes merely to fill the available time. Normal programming
continues at the reserved range's end.

During filler, transmit a black screen with the message **Programming resumes at
<time>** and no audio. The time identifies when guide-visible programming next
resumes, shown in the [programming timezone](0005-recurring-programming-rules.md)
in 12-hour form, such as **Programming resumes at 8:00 PM**. User-selected filler
clips are deferred to a later feature.

The kraziTV Program Guide labels intentional filler intervals **Off air**. This
is a UI representation of non-guide coverage, not a persisted schedule entry or
an XMLTV program listing.

## Technical Behavior

### Fit And Reservation Policy

Treat reserved time ranges as half-open `[startsAt, endsAt)` UTC intervals. Normal
generation may select a whole program only if it ends at or before the next hard
boundary. Deferring a program consumes no playback progress or source rotation.
How a reservation ends a started turn or retains an unstarted one follows
[spec 0004's reservation integration](0004-kraziplan.md#recurring-rule-and-reservation-integration).
A program ending exactly at the boundary needs no filler.

An exact start means the reserved program begins within 1 second of its reserved
time on the server's broadcast timeline. Client buffering, such as Plex's, is
outside this tolerance.

Within a bounded collection block, include only whole programs that fit. A directly
placed item must fit its reserved range; a shorter item can be followed by filler.
Reject an impossible placement rather than silently truncating it. Re-probing
published media retains existing fixed-airtime policy; it does not move the boundary.

A changed reservation or source rebuilds affected future programming while preserving
current transmission. This includes filler already airing: routine edits preserve
its content and planned end, including the displayed resume time, through that end.
Reject edits that would require changing or interrupting that current interval.
Future filler intervals may change and stale preparations must be invalidated.
Recurring exact anchors are not part of this slice; recurring
calendar preferences remain soft until a separate explicit extension is accepted.

### Non-Guide Coverage

kraziBrain determines filler selection and timing. The initial implementation must
provide bounded coverage for any required remainder using the built-in black
screen and resume-time message with no audio. SignalPackager renders that output
for the interval selected by kraziBrain. No cataloged filler media is required;
do not rely on ordinary program schedulability for short filler.

Filler is a playout item, never a fake movie/episode schedule entry. Guide windows
can therefore contain intentional non-program intervals. Distinguish those covered
transmission intervals from schedule gaps requiring repair. A missing guide entry
during explicitly planned filler must not trigger ordinary gap repair.

PlayoutProvider must return filler as current/following transmission, with correct
join offsets and contiguous transitions. Introduce a stable PlayoutCursor capable
of identifying program and filler positions; a schedule entry ID alone is no longer
sufficient. Cursor and preparation validation must use a coherent revision covering
both program entries and persisted inputs that determine filler.

Selection remains snapshot-consistent. Mutations affecting planned transmission
invalidate stale prepared items through the existing transition coordinator. If
the existing schedule revision cannot represent such mutations, explicitly resolve
the extension in an ADR before implementation; do not reuse it with weaker meaning.

## Data Model Impact

Add block reservation timing and enough persisted boundary/coverage information to
derive filler deterministically. Extend cursor and selected-playout contracts. Keep
channel state derived; persist filler instances only if required for stable identity
or accepted policy, not because every transmission item must have its own table.

## Architecture Boundaries

| Area              | Impact                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| Schedule          | Whole programs respect reservations; filler is absent from guide entries |
| Playout timeline  | Includes explicit non-guide coverage and richer cursor identity          |
| Channel state     | Reports filler and its backend-computed join offset                      |
| kraziBrain        | Owns fit, deferral, filler selection, and transmission coverage policy   |
| SignalPackager    | Implements selected filler output and exact transmission deadlines       |
| Provider adapters | Expose only guide programs; do not choose filler or fit policy           |

Workers continue owning one shared signal and consuming selected playout. Use the
existing session preparation/commit and cancellation seams. Resolve any necessary
ADR 0003/0009 extension explicitly before changing coverage semantics.

## Open Questions

- What revision contract will cover filler-only input changes? Proposed: every
  reservation change also advances the existing schedule revision, so no second
  counter is needed. Resolve this in an ADR before implementing playout changes.

## Acceptance Criteria

- A reserved movie starts within 1 second of the selected time on the server's
  broadcast timeline without truncating the preceding program.
- A program that cannot fit is deferred without consuming its collection progress.
- A program ending exactly at the boundary produces no extra filler.
- Every required remainder has explicit continuous transmission coverage.
- Filler displays a black screen with **Programming resumes at <time>** and no audio,
  without requiring a configured clip or cataloged media. The time uses the
  programming timezone in 12-hour form.
- Reservations support both explicit ends and program-derived ends; unused time
  within an explicit range receives filler.
- The kraziTV Program Guide labels planned filler **Off air** without creating a
  schedule entry or XMLTV program listing.
- Filler is listed in XMLTV as **Off air**, never as a schedule entry ([ADR 0022](../../../../adrs/0022-xmltv-lists-off-air.md)), and is visible in backend channel state.
- Tuning during filler joins at the correct offset and reaches the reserved program.
- Planned filler does not trigger gap repair or produce `schedule_gap`.
- Concurrent coverage requests do not duplicate reservations or filler identities.
- A filler/reservation edit invalidates stale preparations while preserving current transmission.
- Routine edits preserve an airing filler interval's content, displayed resume
  time, and planned end; incompatible edits are rejected.
- Program/filler transitions remain one shared signal for all viewers.

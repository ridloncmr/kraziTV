# Clock-Anchored Programming And Boundary Coverage

Status: Draft

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
- Recurring-rule weighting or manual draft storage/publication.

## Dependencies And Spec Boundary

Depends on [multi-source programming](0004-kraziplan.md) and integrates
[recurring rules](0005-recurring-programming-rules.md) when present. Exact boundary
coverage is distinct from approximate airtime and from the override lifecycle in
spec 0007. Deliver a narrow server capability and preview, not a second manual editor.

## Established Behavior And Proposed Policy

Schedules currently contain contiguous whole-program entries. Playout is derived
one-to-one from them, with schedule-entry identity as its cursor. Existing black
tail handles media shorter than its published airtime; it is not a general filler
scheduling policy. The richer playout and reservation behavior here is proposed.

## User-Facing Behavior

A clock-anchored block has an explicit UTC start, source, and end or program-derived
duration. The preview distinguishes an exact commitment from a soft preference and
shows any filler interval required before it. Reject overlapping reservations or
ones that would unexpectedly interrupt the currently airing item.

Proposed initial boundary policy: preserve next-program ordering. If that program
cannot finish before the reservation, defer it and cover the remaining interval.
Do not search later episodes merely to fill the available time. Normal programming
continues at the reserved range's end.

## Technical Behavior

### Fit And Reservation Policy

Treat reserved time ranges as half-open `[startsAt, endsAt)` UTC intervals. Normal
generation may select a whole program only if it ends at or before the next hard
boundary. Deferring a program consumes no playback progress or source rotation.
A program ending exactly at the boundary needs no filler.

Within a bounded collection block, include only whole programs that fit. A directly
placed item must fit its reserved range; a shorter item can be followed by filler.
Reject an impossible placement rather than silently truncating it. Re-probing
published media retains existing fixed-airtime policy; it does not move the boundary.

A changed reservation or source rebuilds affected future programming while preserving
current transmission. Recurring exact anchors are not part of this slice; recurring
calendar preferences remain soft until a separate explicit extension is accepted.

### Non-Guide Coverage

kraziBrain determines filler selection and timing. The initial implementation must
provide bounded coverage for any required remainder. Proposed baseline: explicit
black-and-silence filler, optionally replaced with a user-selected playable filler
clip that can repeat or end at the boundary. Confirm this product choice before
implementation; do not rely on ordinary program schedulability for short filler.

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

- Approve preserving next-program order instead of selecting a shorter later program?
- Approve black-and-silence as guaranteed baseline coverage, or require configured filler?
- Should reserved block ends be explicit, derived from selected programs, or both?
- How should the Program Guide display intentional intervals without guide programs?
- What revision contract will cover filler-only input changes?

## Acceptance Criteria

- A reserved movie starts at the exact selected time without truncating the preceding program.
- A program that cannot fit is deferred without consuming its collection progress.
- A program ending exactly at the boundary produces no extra filler.
- Every required remainder has explicit continuous transmission coverage.
- Filler is absent from XMLTV program listings but visible in backend channel state.
- Tuning during filler joins at the correct offset and reaches the reserved program.
- Planned filler does not trigger gap repair or produce `schedule_gap`.
- Concurrent coverage requests do not duplicate reservations or filler identities.
- A filler/reservation edit invalidates stale preparations while preserving current transmission.
- Program/filler transitions remain one shared signal for all viewers.

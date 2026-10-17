# Manual Programming Overrides And Publishing

Status: Implemented

## Problem

Users need deliberate movie nights, marathons, and one-off specials without replacing
the enduring programming configuration or becoming responsible for daily publication.

## Goals

- Preview and publish future programming overrides as reservations.
- Place individual media items or collection-sourced blocks in reserved time ranges.
- Let the owner start an override while something airs: after it, or by cutting it.
- Resolve overlap and stale publication explicitly.
- Resume deterministic ordinary programming after an override ends or is cancelled.

## Non-goals

- Drafts: saving an override without publishing it.
- Publishing ordinary generated programming every day or replacing the whole channel configuration.
- A complete drag-and-drop guide editor, collaborative editing, or live broadcast-control tools.
- Editing an override after it starts, other than ending it early.
- Hidden interruption, automatic conflict replacement, commercials, or presentation campaigns.

## Dependencies And Spec Boundary

Depends on [kraziPlan](0004-kraziplan.md) and [clock boundary coverage](0006-clock-anchored-blocks.md).
Preserves [recurring rules](0005-recurring-programming-rules.md) when configured.
Interruption follows [ADR 0015](../../../../adrs/0015-scheduled-interruption.md);
regeneration after an override change follows
[ADR 0009](../../../../adrs/0009-programming-blocks.md)'s 2026-10-16 amendment.

Spec 0006 delivers reservations and filler as a server capability with no
administration UI. This spec owns every owner-facing screen that creates, edits,
or cancels a reservation, built on that capability, so the two ship together.
A published override is a reservation; this spec adds no second stored kind.
Catalog removal refuses to remove a media item a reservation lists
(`media_item_in_use`), and collection delete refuses a collection one plays
(`media_collection_in_use`), as for assignments, until the reservation ends;
these screens should offer to edit or cancel it first. An ended reservation is
deleted with the media or collection it aired. A reservation airs even on a
channel with no usable ordinary programming, which shows filler until it.

## User-Facing Behavior

1. Select a future start, up to one year ahead, and build a special from
   individual media or a collection block.
2. Inspect the backend preview: exact range, selected programs, filler, conflicts,
   displaced generated programming, and the normal programming that resumes afterward.
3. Save. Saving publishes the previewed special; the guide changes only after it succeeds.
4. Edit or cancel a special that has not started; normal generation fills released time.
5. End a running special early; it cannot otherwise be edited once it starts.

Ordinary generated programming continues around specials and requires no publishing
action. A special booked far ahead affects nothing until the schedule horizon
reaches it, so an unsure owner can book it early and keep editing it. A simple
form/list editor is sufficient initially; direct manipulation of a guide grid is
later UI work.

### Preview Beyond The Horizon

The preview always shows the special itself. Ordinary programming is materialized
only within the schedule horizon (72 hours), so for a special that starts beyond
it the preview says the surrounding schedule is planned closer to the date, and
nothing is displaced yet. A listed-item special previews exactly. A collection
special's programs depend on collection progress when generation reaches it, so
the preview labels them as estimated.

### Starting While Something Airs

When a special's start falls before the airing playout item, program or filler,
ends, the screen asks **What is airing now**, as the Rebuild the schedule dialog does:

- **Let it finish.** The special starts when the airing item ends; the preview
  shows the adjusted start.
- **Stop it at the special's start.** The airing item is cut at the chosen start,
  which may be now or a later instant inside it. The cut is seamless: viewers stay
  tuned and see the program cut straight into the special.

The choice never appears for a start after the airing item ends. Ending a running
special early moves its end earlier and offers the same two choices: let the
airing program finish, which ends the special when that program ends, or cut it at
a chosen instant, which ends the special there. A special whose end falls inside its
own airing program cuts that program at its end, seamlessly, and normal programming
follows. Editing or cancelling
an interrupting special before its start restores the airing item's full airtime.

### Full-Series Marathons From The Beginning

For a deliberate full-series marathon, the user may select a collection and an
ordered playback mode, then explicitly choose **Start from the beginning**.
Resolve the collection into a finite ordered list of direct media placements
for the special. For example, an eight-film Harry Potter collection in release
order produces eight placements starting with the first film, not the ordinary
rotation's next film. Random playback is not offered for this ordered event.

Preview every selected film and the resulting program-derived reservation end.
Select each collection member once; do not wrap the collection or add movies to
meet an airtime target. Report unavailable members for correction before publication,
rather than silently skipping a film in a full-series event. The ordered placement
list is the event's explicit selection snapshot; later collection membership or
ordering changes do not silently change it. Item removal and changed durations
follow the existing invalidation and revalidation policy.

Because these are direct placements, starting from the beginning never resets or
advances ordinary channel/collection/mode progress. Event continuation across
generation chunks and restarts follows the saved placements and retained entries,
not a second collection playback cursor. After the event, normal programming
resumes under the displacement and restoration policy below. These deliberate
events do not consume or reset kraziPlan's generated marathon cooldown.

## Technical Behavior

### Validation And Publication

Reservations use half-open UTC ranges. Adjacent reservations are allowed;
overlapping ones are rejected. A reservation crossing the airing item is rejected
unless the owner marks it as interrupting. Past placement, a start more than one
year ahead, and edits to a started reservation (`reservation_started`) are rejected,
except ending it early by moving its end to an instant from now through its current end.

Validate item existence, schedulability, fit, channel ownership/enabled state, and
reservation conflicts on the server. Preview uses copied progress and the same
domain generation policy, without materializing live entries or advancing progress.
Identify the configuration, catalog inputs, and schedule snapshot used for preview
so publication can detect stale decisions.

Publication acquires existing write authority before re-reading affected state.
Revalidate the preview's relevant inputs and either publish atomically with its
first schedule/coverage mutation or return a conflict requiring a refreshed preview.
Do not silently publish a materially different selection from the preview. Coverage
beyond the first committed chunk resumes through existing bounded maintenance.
Use a request identity or equivalent idempotency guard so retries cannot duplicate
the override. Stored future reservations can exist beyond the materialized horizon.

### Displacement, Regeneration, And Progress

Published overrides take precedence over generated blocks in their reserved range.
Keep enduring assignments and rules; do not store a second authoritative schedule
underneath the override. Creating, editing, or cancelling a reservation regenerates
ordinary programming from the regeneration boundary, as every other input change
does: delete future decisions, restore their consumed progress, and generate again
around every reservation. No other reservation and never the airing item moves.

| Programming                      | Effect on ordinary collection progress                                |
| -------------------------------- | --------------------------------------------------------------------- |
| Displaced generated programs     | Consume no progress                                                   |
| Collection-sourced manual blocks | Consume the same channel/collection/mode progress as generated blocks |
| Directly placed media items      | Consume no collection progress, even if the item belongs to one       |
| Filler                           | Consumes no collection progress                                       |
| A program cut by interruption    | Counts as aired, like any program that started                        |

After the range ends, evaluate recurring rules at that time and resume ordinary
generation from restored progress. This is deterministic continuation, not a
promise that the old displaced schedule will air at identical later timestamps.
A completed override remains historical provenance, not a repeating event.

### Interruption

An interrupting reservation follows [ADR 0015](../../../../adrs/0015-scheduled-interruption.md).
The cut is derived from the reservation, never written into the airing entry, and
the channel stream worker crosses into the reservation at its start without
dropping subscribers. Routine publication of a non-interrupting reservation never
changes the current signal; schedule changes invalidate only revocable future
preparations.

## Data Model Impact

Add an interrupting flag to reservations, preview revision tokens, publication
request identity, and block provenance. Store reservations separately from their
bounded materialized entries. Preserve restorable selection bookkeeping and
references needed by catalog removal and conflict previews.

## Architecture Boundaries

| Area              | Impact                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Schedule          | Published overrides materialize authoritative programs under existing transactional policy |
| Playout timeline  | Combines those programs with spec 0006 boundary coverage and derived cuts                  |
| Channel state     | Preserves current transmission unless the owner chose an interrupting reservation          |
| kraziBrain        | Owns precedence, conflict/fit decisions, cuts, restoration, and resumed programming        |
| SignalPackager    | Ends the airing item at a cut and continues the signal; never chooses overrides            |
| Provider adapters | Expose the published schedule                                                              |

Server capabilities own authorization, publication transactions, and API error
mapping. My Channels/Program Guide consume server previews and conflict decisions.
Existing authentication gates these administrative operations.

## Resolved Decisions

Decided with the owner on 2026-10-16.

| Question                                      | Decision                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Downstream reflow under ADR 0009              | Regenerate from the regeneration boundary, as built in spec 0006; ADR 0009 amended         |
| Collection-sourced manual blocks and progress | Consume progress like generated blocks, as built in spec 0006                              |
| Changing a running special                    | Not editable once started; it can only be ended early                                      |
| How far ahead                                 | Up to one year; the preview labels what beyond the horizon is not yet planned or estimated |
| Catalog removal and drafts                    | No drafts, so removal only meets published reservations, which already refuse it           |
| Interruption in this release                  | Yes, now or at a chosen later instant, cut seamlessly (ADR 0015)                           |
| Drafts                                        | Cut; saving after a preview publishes                                                      |

## Acceptance Criteria

- Publishing a Saturday movie night affects only its validated future programming scope.
- A full-series event explicitly starting from the beginning previews and publishes
  each selected movie once in the chosen order, then ends without wrapping.
- An unavailable series member prevents publication until corrected; membership
  edits cannot silently replace the event's saved placements.
- A full-series event leaves ordinary collection progress and generated marathon
  cooldown unchanged; restart or chunked coverage resumes saved event placements.
- Overlapping specials and stale previews are rejected with actionable conflicts.
- Retrying publication cannot duplicate the override or consume progress twice.
- Publishing beyond the horizon preserves the reservation until generation reaches it,
  and a start more than one year ahead is rejected.
- Displaced generated programs consume no progress; collection-sourced manual blocks
  consume it as generated blocks do.
- Normal recurring programming resumes after the special without daily publication.
- Cancelling a future special restores generated programming and respects other reservations.
- An airing program remains unchanged under routine publication or cancellation.
- A started special refuses edits and can be ended early, letting the airing program
  finish or cutting it.
- An interrupting special cuts the airing item at its start, now or later, within the
  exact-start tolerance, without disconnecting subscribers; the guide shows the cut.
- Cancelling an interrupting special before its start restores the airing item's full airtime.
- A removed item or changed duration forces explicit revalidation rather than silent substitution.
- Restart and concurrent publication/coverage yield coherent revisions and stable reservations.
- A prepared transition invalidated by publication or a cut cannot become the next committed program.

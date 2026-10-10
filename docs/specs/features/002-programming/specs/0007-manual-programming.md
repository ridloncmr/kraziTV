# Manual Programming Overrides And Publishing

Status: Draft

## Problem

Users need deliberate movie nights, marathons, and one-off specials without replacing
the enduring programming configuration or becoming responsible for daily publication.

## Goals

- Draft, preview, and publish future programming overrides.
- Place individual media items or collection-sourced blocks in reserved time ranges.
- Resolve overlap and stale publication explicitly.
- Resume deterministic ordinary programming after an override ends or is cancelled.

## Non-goals

- Publishing ordinary generated programming every day or replacing the whole channel configuration.
- A complete drag-and-drop guide editor, collaborative editing, or live broadcast-control tools.
- Hidden interruption, automatic conflict replacement, commercials, or presentation campaigns.

## Dependencies And Spec Boundary

Depends on [kraziPlan](0004-kraziplan.md) and [clock boundary coverage](0006-clock-anchored-blocks.md).
Preserves [recurring rules](0005-recurring-programming-rules.md) when configured.
Drafting, validation, and publication form a transactional lifecycle, separate from
recurring source eligibility and from transmission fit mechanics.

## Established Behavior And Proposed Policy

ADR 0009 establishes saved overrides taking precedence over generated blocks and
localized edits that preserve the airing entry. Existing ScheduleService rebuilds
the future from that entry's end. The override policies below are proposals, not
implemented guarantees.

## User-Facing Behavior

1. Select a future start and draft a special from individual media or collection blocks.
2. Inspect the backend preview: exact range, selected programs, filler, conflicts,
   displaced generated programming, and the normal programming that resumes afterward.
3. Publish the validated override. The guide changes only after successful publication.
4. Edit or cancel future published programming; normal generation fills released time.

Drafts can be saved without affecting broadcast. Ordinary generated programming
continues around them and requires no publishing action. A simple form/list editor
is sufficient initially; direct manipulation of a guide grid is later UI work.

## Technical Behavior

### Validation And Publication

Reservations use half-open UTC ranges. Adjacent published overrides are allowed;
overlapping published manual reservations are rejected. Reject an override crossing
the airing program unless the user explicitly requests interruption. Past placement
is rejected; editing the unstarted future portion of a running special requires a
new preview and cannot rewrite what has already aired.

Validate item existence, schedulability, fit, channel ownership/enabled state, and
reservation conflicts on the server. Preview uses copied progress and the same
domain generation policy, without materializing live entries or advancing progress.
Identify the configuration, catalog inputs, draft revision, and schedule snapshot
used for preview so publication can detect stale decisions.

Publication acquires existing write authority before re-reading affected state.
Revalidate the preview's relevant inputs and either publish atomically with its
first schedule/coverage mutation or return a conflict requiring a refreshed preview.
Do not silently publish a materially different selection from the preview. Coverage
beyond the first committed chunk resumes through existing bounded maintenance.
Use a request identity or equivalent idempotency guard so retries cannot duplicate
the override. Stored future reservations can exist beyond the materialized horizon.

### Displacement And Progress

Published overrides take precedence over generated blocks in their reserved range.
Keep enduring assignments and rules; do not store a second authoritative complete
schedule underneath the override. Delete displaced future decisions and restore
their consumed progress before generating the replacement.

Proposed progress policy:

| Programming                      | Effect on ordinary collection progress                                |
| -------------------------------- | --------------------------------------------------------------------- |
| Displaced generated programs     | Consume no progress                                                   |
| Collection-sourced manual blocks | Consume the same channel/collection/mode progress as generated blocks |
| Directly placed media items      | Consume no collection progress, even if the item belongs to one       |
| Filler                           | Consumes no collection progress                                       |

After the range ends, evaluate recurring rules at that time and resume ordinary
generation from restored progress. This is deterministic continuation, not a
promise that the old displaced schedule will air at identical later timestamps.
Cancellation restores decisions from retained entries and generates released time
again. A completed override remains historical provenance, not a repeating event.

### Regeneration Scope And Architectural Resolution

For a replacement contained within unchanged boundaries with unchanged collection
progress effects, preserve unrelated future blocks and entries. Duration changes or
manual collection consumption can affect downstream selection or start times.
Preview the affected scope; never overwrite another published reservation silently.

Before implementation, resolve ADR 0009's statement that edited blocks replace only
their own future entries. Either constrain edits so that localized replacement is
possible, or accept an explicit ADR amendment defining bounded downstream reflow
and restoration checkpoints. This draft does not authorize ignoring that constraint.

Explicit interruption must use the existing administrative lifecycle and disclose
its viewer effect. Routine publication never stops the current shared signal;
schedule changes invalidate only revocable future preparations.

## Data Model Impact

Add drafts with ordered placements, published override identity/ranges, revision
tokens, publication request identity, and block provenance. Store reservations
separately from their bounded materialized entries. Preserve restorable selection
bookkeeping and references needed by catalog removal and conflict previews.

Removal impact must account for drafts and published reservations. A reference
cannot silently disappear and yield a different special; refuse or return explicit
invalidation requiring a new preview according to the finalized removal policy.

## Architecture Boundaries

| Area              | Impact                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Schedule          | Published overrides materialize authoritative programs under existing transactional policy |
| Playout timeline  | Combines those programs with spec 0006 boundary coverage                                   |
| Channel state     | Preserves current transmission unless explicitly interrupted                               |
| kraziBrain        | Owns precedence, conflict/fit decisions, restoration, and resumed programming              |
| SignalPackager    | Receives selected playout; never chooses overrides or publishes a guide                    |
| Provider adapters | Expose the published schedule, never drafts                                                |

Server capabilities own draft persistence, authorization, publication transactions,
and API error mapping. My Channels/Program Guide consume server previews and
conflict decisions. Existing authentication gates these administrative operations.

## Open Questions

- Approve shared progress consumption for collection-sourced manual marathons?
- Should changing an already-running special be limited to its unstarted placements?
- Which downstream reflow policy should amend or satisfy ADR 0009?
- How far ahead may drafts/reservations be stored and previews requested?
- Should catalog removal refuse referenced media or explicitly invalidate its draft/reservation?
- Is explicit interruption required in this release, or should conflicts with current airing always be rejected?

## Acceptance Criteria

- Saving an unpublished draft changes neither guide, channel state, nor progress.
- Publishing a Saturday movie night affects only its validated future programming scope.
- Overlapping published specials and stale previews are rejected with actionable conflicts.
- Retrying publication cannot duplicate the override or consume progress twice.
- Publishing beyond the horizon preserves the reservation until generation reaches it.
- Displaced generated programs consume no progress; the chosen manual progress policy is reproducible.
- Normal recurring programming resumes after the special without daily publication.
- Cancelling a future special restores generated programming and respects other reservations.
- An airing program remains unchanged under routine publication or cancellation.
- A removed item or changed duration forces explicit revalidation rather than silent substitution.
- Restart and concurrent publication/coverage yield coherent revisions and stable reservations.
- A prepared transition invalidated by publication cannot become the next committed program.

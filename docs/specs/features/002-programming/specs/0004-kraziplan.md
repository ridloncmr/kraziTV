# Continuous Multi-Source Programming With kraziPlan

Status: Draft

## Problem

A single looping block cannot mix several collections while preserving each
collection's playback progress. Users need an enduring channel configuration,
not a daily schedule they must author or publish.

## Goals

- Continuously generate programming from several channel source assignments.
- Alternate useful stretches of whole programs with independent collection progress.
- Preserve single-source looping and operate without metadata enrichment.
- Make generation deterministic, bounded, and resumable across requests and restarts.

## Non-goals

- Calendar rules, exact clock boundaries, manual publishing, or filler.
- Weighted optimization, strict airtime quotas, arbitrary scripting, or viewer-specific programming.
- Replacing schedule entries as guide authority or placing programming policy in SignalPackager.

## Dependencies And Spec Boundary

Depends on existing blocks, schedule materialization, and progress restoration.
Integrates [playback ordering](0003-playback-ordering.md) when available, but basic
multi-source programming can ship with current modes and manually built collections.
This spec provides useful continuous rotation independently of calendar behavior.

## Established Behavior And Proposed Policy

ADR 0009 places kraziPlan inside kraziBrain and requires it to generate programming
blocks rather than schedule entries. The MVP's one-block constraint is a separate
unique index. The generation and source-assignment behavior below is proposed.

## User-Facing Behavior

The user assigns collections to a channel, orders those assignments, chooses each
one's playback mode, and sets an approximate airtime target. For example:

| Source               | Ordering      | Target stretch |
| -------------------- | ------------- | -------------- |
| The Office           | Episode order | 60 minutes     |
| Family Guy           | Random        | 60 minutes     |
| Parks and Recreation | Episode order | 60 minutes     |

kraziTV rotates through the assignments forever. A stretch finishes whole programs
until it reaches or exceeds its target; a movie longer than the target airs whole.
The UI displays expected overrun rather than implying an exact hour.

The user can inspect upcoming programming and its source. No daily publication is
required. An empty or unschedulable assignment is skipped with an explanation.
If every assignment is unusable, report the channel's unschedulable condition;
do not invent a guide program or spin indefinitely.

## Technical Behavior

### Inputs, Blocks, And Materialization

A programming source assignment is enduring channel configuration: collection,
playback mode, saved rotation position, and positive airtime target. Initially
allow one assignment per collection on a channel; recurring rules later reference
these assignments rather than duplicating collection progress.

Without recurring rules, all assignments participate in default rotation. Spec 0005
extends participation to distinguish default assignments from rule-only assignments,
so seasonal sources can be configured without airing year-round.

kraziPlan chooses the next assignment and produces a programming block with source,
target, and decision provenance. The schedule capability resolves whole programs,
their exact durations, and the block's resulting end, then continues the rotation.
Use explicit composition between these capabilities rather than two independent
simulations of media selection. kraziPlan never writes schedule entries directly.

Server orchestration persists generated blocks, entries, continuation, and
collection progress coherently. Generate only bounded future coverage; keep the
existing horizon and request limits unless separately changed. Coverage extension
appends blocks and entries without rewriting covered windows. Cleanup must retain
all provenance or checkpoints still needed for progress restoration.

### Determinism And Continuation

Each new source turn starts with zero accumulated airtime and the assignment's
full target. Select the next whole program in that source's playback order, add
its scheduled duration, and continue while accumulated airtime is below the target.
End the turn as soon as accumulated airtime meets or exceeds the target. Thus a
60-minute target with 22-minute episodes selects three episodes totaling 66 minutes;
an exactly 60-minute program ends the turn, and a 120-minute movie airs whole.

Targets are independent per turn. Do not carry surplus or deficit into another
turn, track airtime debt, or compensate for a calendar or reservation boundary
ending a turn early. Collection playback progress still continues normally.

Rotate in saved assignment order. Skipped assignments consume no collection
selection. Persist the next rotation position and any unfinished block target so
transaction chunk boundaries cannot change the selected programming. Restore these
decisions, together with collection progress, when future entries are deleted.

An unfinished target retained across generation chunks or restart belongs to the
same turn, not an airtime balance across turns. Calendar features or reservations
ending that turn discard its remainder; its source's next turn has a fresh target.

Random uses its existing channel-and-collection seed, not a block ID or another
collection's airing count. Ordered collections resume their own mode's progress.
Repeated cycles require no manual reset, even when a collection contains one item.

### Configuration And Migration

Migrate an existing collection-sourced loop to one enduring source assignment,
keeping its playback mode, schedule anchor, seed, and retained progress. Preserve
existing single-media-item looping configuration as supported direct programming;
do not require converting it into a one-item collection.

Assignment edits use existing scheduling input-change orchestration and preserve
the airing entry. New future blocks reflect the edit; block IDs are provenance,
not a source of random entropy. A preview uses the same domain decisions on copied
inputs without persisting blocks, entries, or progress.

## Data Model Impact

Add source assignments, generated block timing/targets and origin, and restorable
rotation continuation. Remove the one-block index through a new migration. Extend
the loader that currently selects one block; simply dropping the index is not
sufficient. Keep channel identity, collection membership, and per-collection
progress ownership intact.

## Architecture Boundaries

| Area              | Impact                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| Schedule          | Materializes entries from a bounded sequence of blocks                    |
| Playout timeline  | Consumes entries without choosing sources                                 |
| Channel state     | Backend-derived; future configuration edits preserve current airing       |
| kraziBrain        | kraziPlan owns source rotation; schedule capability owns entry generation |
| SignalPackager    | No programming decisions or new per-viewer sessions                       |
| Provider adapters | Continue exposing the materialized guide and shared channel URLs          |

`apps/server` owns persistence, transactions, administrative routes, and triggers.
My Channels consumes backend previews and status. Reuse existing selection,
progress restoration, coverage, and transition-coordination capabilities.

## Open Questions

- What airtime target should a newly assigned source receive by default?
- Should users also be able to choose a number of programs per stretch initially?
- How should the UI convert an existing direct-item loop into multi-source programming?
- Should editing source rotation reset rotation position or continue after the last retained assignment?

## Acceptance Criteria

- Configure four collections once and generate weeks of programming without daily edits.
- Each collection resumes its own ordering after the others air.
- A 60-minute target airs whole programs and explains any overrun.
- With 22-minute episodes and a 60-minute target, each uninterrupted turn airs
  three episodes (66 minutes); a later turn still targets 60 minutes.
- Exact target equality ends the turn without selecting an additional program.
- An early-ended turn creates no airtime debt; the source's next turn starts with
  its full target and continues its collection playback progress.
- Unschedulable sources are skipped; an entirely unusable channel reports why.
- One source or one available member continues looping indefinitely.
- Single-source migration preserves existing ordering, random seed, and covered entries.
- Restart and different transaction chunk sizes produce equivalent programming decisions.
- Preview changes neither published entries nor persisted progress.
- Editing assignments mid-program preserves its airing entry and invalidates stale future preparations.
